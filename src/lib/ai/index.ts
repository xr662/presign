// 服务端专用：密钥只在这里读。被浏览器端代码 import 时，构建会直接报错（server-only）。
import "server-only";

import { limitsFromEnv, rolesFromEnv } from "./config.ts";
import { createAi, type Ai } from "./core.ts";
import { UsageStore } from "./usage.ts";

let instance: Ai | null = null;

export function ai(): Ai {
  instance ??= createAi({
    roles: rolesFromEnv(),
    limits: limitsFromEnv(),
    usage: new UsageStore(process.env.USAGE_DB_PATH || "data/runtime/usage.db"),
  });
  return instance;
}

export type { Purpose, Role } from "./config.ts";
export * from "./errors.ts";
