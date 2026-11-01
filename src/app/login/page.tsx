import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "登录" };

// 只开放评审账号，不开放注册（控制接口费用，项目方案第 8 节）。示例合同不用登录就能看。
// 页面上按普通登录写，不写"仅限评审""参赛演示"（Rui 11-01 定）。
export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-sm px-4 py-14">
        <h1 className="text-2xl font-semibold">登录</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          没有账号可以先看
          <Link href="/samples" className="underline">
            示例合同
          </Link>
          的检查过程。
        </p>
        <LoginForm />
      </main>
      <SiteFooter />
    </>
  );
}
