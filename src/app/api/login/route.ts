// 评审账号登录：用户名 + 密码，对了就发签名 Cookie。不开放注册（项目方案第 8 节）。
// 同一个 IP 10 分钟内输错 10 次就先停 10 分钟，挡住试密码。计数在内存里，服务重启清零，够用。
import { z } from "zod";
import { checkLogin } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";

const schema = z.object({
  user: z.string().trim().min(1).max(64),
  pass: z.string().min(1).max(200),
});

const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, number[]>();

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function clientIp(req: Request) {
  // 部署时前面是本机的 Caddy，它会把真实 IP 写进 X-Forwarded-For 的第一个
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function POST(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return json(503, { error: "not_configured", message: "登录还没配置好，请联系作者" });

  const ip = clientIp(req);
  const now = Date.now();
  const recent = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS)
    return json(429, { error: "too_many", message: "输错次数太多，请 10 分钟后再试" });

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return json(400, { error: "bad_request", message: "请填写账号和密码" });

  if (!checkLogin(body.data.user, body.data.pass)) {
    fails.set(ip, [...recent, now]);
    return json(401, { error: "wrong", message: "账号或密码不对" });
  }
  fails.delete(ip);
  return json(
    200,
    { ok: true },
    { "Set-Cookie": sessionCookie(createSession(body.data.user, secret)) },
  );
}
