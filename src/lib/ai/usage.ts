// 用量记账：每次模型调用记一行（时间、供应商、角色、用途、请求数、token、耗时、是否成功）。
// 只记数字，不记提示词和合同内容。用 Node 内置的 node:sqlite，网站进程重启后计数还在。
// 调用前检查三样：当天 token 预算、平台 5 小时 / 7 天 / 30 天的请求次数。

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Limits } from "./config";
import { BudgetExceededError } from "./errors";

export type CallRecord = {
  ts: number;
  provider: string;
  role: string;
  purpose: string;
  ok: boolean;
  // 带工具的调用一次会发多个请求，按实际步数记
  requests: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// 每日预算按北京时间零点切分
const CN_OFFSET = 8 * HOUR;
export const dayStartCN = (now: number) => Math.floor((now + CN_OFFSET) / DAY) * DAY - CN_OFFSET;

export class UsageStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        ts INTEGER NOT NULL, provider TEXT, role TEXT, purpose TEXT, ok INTEGER,
        requests INTEGER, input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER, error TEXT
      );
      CREATE INDEX IF NOT EXISTS calls_ts ON calls(ts);
    `);
  }

  record(c: CallRecord) {
    this.db
      .prepare("INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        c.ts,
        c.provider,
        c.role,
        c.purpose,
        c.ok ? 1 : 0,
        c.requests,
        c.inputTokens,
        c.outputTokens,
        c.latencyMs,
        c.error ?? null,
      );
  }

  /** 窗口内的请求次数，以及最早一条的时间（用来算什么时候恢复） */
  private requestsIn(provider: string, since: number) {
    return this.db
      .prepare(
        "SELECT COALESCE(SUM(requests), 0) AS n, MIN(ts) AS first FROM calls WHERE provider = ? AND ts >= ?",
      )
      .get(provider, since) as { n: number; first: number | null };
  }

  tokensSince(since: number): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM calls WHERE ts >= ?",
      )
      .get(since) as { n: number };
    return row.n;
  }

  /** 超限就抛 BudgetExceededError，带恢复时间 */
  check(provider: string, limits: Limits, now = Date.now()) {
    const day = dayStartCN(now);
    if (this.tokensSince(day) >= limits.dailyTokens)
      throw new BudgetExceededError("daily_tokens", day + DAY);
    const windows = [
      ["requests_5h", 5 * HOUR, limits.requests5h],
      ["requests_7d", 7 * DAY, limits.requests7d],
      ["requests_30d", 30 * DAY, limits.requests30d],
    ] as const;
    for (const [reason, span, max] of windows) {
      const { n, first } = this.requestsIn(provider, now - span);
      if (n >= max) throw new BudgetExceededError(reason, (first ?? now) + span);
    }
  }

  summary(now = Date.now()) {
    return this.db
      .prepare(
        `SELECT role, purpose, COUNT(*) AS calls, SUM(ok) AS ok, SUM(requests) AS requests,
                SUM(input_tokens) AS input, SUM(output_tokens) AS output, ROUND(AVG(latency_ms)) AS avg_ms
         FROM calls WHERE ts >= ? GROUP BY role, purpose ORDER BY calls DESC`,
      )
      .all(dayStartCN(now));
  }

  close() {
    this.db.close();
  }
}
