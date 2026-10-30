// 当前登录的评审账号。会话 Cookie 是 HttpOnly，页面脚本读不到，检查页靠这里决定要不要先提示登录。
// required 为 false 表示本机开发没配 SESSION_SECRET，不需要登录。
import { cookieValue, readSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  const secret = process.env.SESSION_SECRET;
  const required = Boolean(secret) || process.env.NODE_ENV === "production";
  const user = secret ? readSession(cookieValue(req), secret) : null;
  return Response.json({ user, required }, { headers: { "Cache-Control": "no-store" } });
}
