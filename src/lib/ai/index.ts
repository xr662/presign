// 服务端专用：密钥只在这里读。被浏览器端代码 import 时，构建会直接报错（server-only）。
import "server-only";

import { limitsFromEnv, rolesFromEnv } from "./config.ts";
import { createAi, type Ai } from "./core.ts";
import { UsageStore } from "./usage.ts";

let store: UsageStore | null = null;
let instance: Ai | null = null;

const usage = () => (store ??= new UsageStore(process.env.USAGE_DB_PATH || "data/runtime/usage.db"));

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

export type { Purpose, Role } from "./config.ts";
export * from "./errors.ts";
