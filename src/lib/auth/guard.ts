// 会调模型的接口都先过这一关（项目方案第 8 节"密钥与接口防盗用"）。
// 1. 来源：只接受本站页面发来的请求，其他网站的页面调不了。
// 2. 登录：T11 接入评审账号之前，生产环境一律拒绝，只有本机开发时放行。
import "server-only";

export type GuardFailure = { status: number; error: string; message: string };

export function checkModelRequest(req: Request): GuardFailure | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok)
      return { status: 403, error: "bad_origin", message: "请求来源不对，请在签前网站上操作" };
  }
  if (process.env.NODE_ENV === "production") {
    return { status: 401, error: "login_required", message: "请先登录评审账号" };
  }
  return null;
}
