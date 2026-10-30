// 退出登录：把会话 Cookie 清掉
import { sessionCookie } from "@/lib/auth/session";

export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", 0) } },
  );
}
