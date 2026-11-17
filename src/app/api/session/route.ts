// 当前登录的评审账号。会话 Cookie 是 HttpOnly，页面脚本读不到，检查页靠这里决定要不要先提示登录。
// required 为 false 表示本机开发没配 SESSION_SECRET，不需要登录。
//
// 必须先 await connection()：开了 cacheComponents，GET 接口没用到动态数据就会在构建时预渲染成静态文件。
// 11-17 线上出过这个问题：构建产物里这个接口固定返回 {"user":null}，登录成功、Cookie 也有，页面仍提示"请先登录"。
// scripts/check-api-dynamic.mjs 在构建后检查，接口被预渲染就报错。
import { connection } from "next/server";
import { cookieValue, readSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  await connection();
  const secret = process.env.SESSION_SECRET;
  const required = Boolean(secret) || process.env.NODE_ENV === "production";
  const user = secret ? readSession(cookieValue(req), secret) : null;
  return Response.json({ user, required }, { headers: { "Cache-Control": "no-store" } });
}
