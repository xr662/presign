// 登录会话：签名 Cookie，服务端不存会话。内容是 {u: 用户名, exp: 过期时间}，用 SESSION_SECRET 做 HMAC-SHA256 签名。
// Cookie 设 HttpOnly（页面脚本读不到）、SameSite=Strict（别的网站发起的请求不带）、生产环境加 Secure（只走 HTTPS）。

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "presign_session";
export const SESSION_DAYS = 7;

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function createSession(user: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: user, exp: now + SESSION_DAYS * 86_400_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** 签名对、没过期才返回用户名 */
export function readSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u: string;
      exp: number;
    };
    return typeof u === "string" && exp > now ? u : null;
  } catch {
    return null;
  }
}

export function cookieValue(req: Request, name = SESSION_COOKIE): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSec = SESSION_DAYS * 86_400): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}
