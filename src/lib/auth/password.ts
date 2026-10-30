// 评审账号的密码：scrypt 加盐哈希，账号写在环境变量 JUDGE_ACCOUNTS 里（项目方案第 8 节）。
// 格式：用户名:scrypt$盐$哈希（盐和哈希是 base64url），多个账号用逗号分隔。哈希用 npm run account:hash 生成。
// 用 Node 内置的 crypto.scrypt，不装 bcrypt 这类原生模块（Windows 构建的产物要能直接拷到 Linux）。

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt 参数：N=2^14、r=8、p=1，单次约 50ms、16MB 内存，2 核 2G 的服务器扛得住，暴力试密码又足够慢
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, PARAMS);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function accountsFromEnv(raw = process.env.JUDGE_ACCOUNTS ?? ""): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of raw.split(",")) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    map.set(item.slice(0, i).trim(), item.slice(i + 1).trim());
  }
  return map;
}

// 账号不存在时也算一遍哈希，响应时间不暴露账号是否存在
const DUMMY = hashPassword(randomBytes(12).toString("hex"));

/** 用户名和密码都对才返回 true */
export function checkLogin(user: string, password: string, accounts = accountsFromEnv()): boolean {
  const stored = accounts.get(user);
  const ok = verifyPassword(password, stored ?? DUMMY);
  return Boolean(stored) && ok;
}
