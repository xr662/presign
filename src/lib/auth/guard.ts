// 会调模型的接口都先过这一关（项目方案第 8 节"密钥与接口防盗用"）。
// 1. 来源：只接受本站页面发来的请求，其他网站的页面调不了。
// 2. 登录：要有有效的评审账号会话（签名 Cookie）。本机开发没配 SESSION_SECRET 时放行，方便调试；
//    生产环境没配 SESSION_SECRET 一律拒绝，配置漏了也不会变成谁都能调。
import "server-only";
import { cookieValue, readSession } from "./session";

export type GuardFailure = { status: number; error: string; message: string };
export type GuardResult = { ok: true; user: string } | ({ ok: false } & GuardFailure);

export function checkModelRequest(req: Request, env = process.env): GuardResult {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    let same = false;
    try {
      same = new URL(origin).host === host;
    } catch {
      same = false;
    }
    if (!same)
      return {
        ok: false,
        status: 403,
        error: "bad_origin",
        message: "请求来源不对，请在签前网站上操作",
      };
  }
  const secret = env.SESSION_SECRET;
  if (!secret) {
    if (env.NODE_ENV !== "production") return { ok: true, user: "dev" };
    return { ok: false, status: 401, error: "login_required", message: "请先登录评审账号" };
  }
  const user = readSession(cookieValue(req), secret);
  if (!user)
    return { ok: false, status: 401, error: "login_required", message: "请先登录评审账号" };
  return { ok: true, user };
}
