import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "登录" };

// 登录页骨架。只开放评审账号，不开放注册（控制接口费用）。T11 接入会话和限额。
export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-sm px-4 py-14">
        <h1 className="text-2xl font-semibold">登录</h1>
        <p className="mt-2 text-sm text-ink-2">本站为参赛演示，只开放评审账号。</p>
        <form className="mt-6 space-y-4">
          <div>
            <label htmlFor="user" className="text-sm font-medium">
              账号
            </label>
            <input
              id="user"
              name="user"
              autoComplete="username"
              className="mt-1 h-9 w-full rounded-md border border-line bg-card px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pass" className="text-sm font-medium">
              密码
            </label>
            <input
              id="pass"
              name="pass"
              type="password"
              autoComplete="current-password"
              className="mt-1 h-9 w-full rounded-md border border-line bg-card px-3 text-sm"
            />
          </div>
          <Button type="submit" className="w-full" disabled>
            登录
          </Button>
        </form>
      </main>
      <SiteFooter />
    </>
  );
}
