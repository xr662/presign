// 服务端专用：密钥只在这里读。被浏览器端代码 import 时，构建会直接报错（server-only）。
import "server-only";

import { limitsFromEnv, rolesFromEnv } from "./config.ts";
import { createAi, type Ai } from "./core.ts";
import { UsageStore } from "./usage.ts";

let store: UsageStore | null = null;
let instance: Ai | null = null;

const usage = () =>
  (store ??= new UsageStore(process.env.USAGE_DB_PATH || "data/runtime/usage.db"));

export function ai(): Ai {
  instance ??= createAi({ roles: rolesFromEnv(), limits: limitsFromEnv(), usage: usage() });
  return instance;
}

/** 每个评审账号每天能检查几份（DAILY_REVIEWS_PER_ACCOUNT，默认 20）。没到上限就记一次 */
export function takeReview(user: string): { ok: boolean; limit: number } {
  const n = Number(process.env.DAILY_REVIEWS_PER_ACCOUNT);
  const limit = Number.isFinite(n) && n > 0 ? n : 20;
  return { ok: usage().takeReview(user, limit), limit };
}

/**
 * 谈判练习每个账号每天能对话几轮（DAILY_PRACTICE_TURNS，默认 60，一次练习最多 8 轮）。
 * 和检查份数记在同一张表，用户名后加 #practice 区分，不用为它加表。
 */
export function takePracticeTurn(user: string): { ok: boolean; limit: number } {
  const n = Number(process.env.DAILY_PRACTICE_TURNS);
  const limit = Number.isFinite(n) && n > 0 ? n : 60;
  return { ok: usage().takeReview(`${user}#practice`, limit), limit };
}

export type { Purpose, Role } from "./config.ts";
export * from "./errors.ts";
