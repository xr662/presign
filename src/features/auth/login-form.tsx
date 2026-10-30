"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// 登录表单。成功后回到来的页面（?next=），没有就去检查页。只接受站内路径，防止被拿来跳到别的网站
export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const data = new FormData(form);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: data.get("user"), pass: data.get("pass") }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "登录没有成功，请重试");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/check";
    } catch {
      setError("连不上服务器，请检查网络");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <div>
        <label htmlFor="user" className="text-sm font-medium">
          账号
        </label>
        <input
          id="user"
          name="user"
          required
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
          required
          autoComplete="current-password"
          className="mt-1 h-9 w-full rounded-md border border-line bg-card px-3 text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-sm bg-red-pen-bg px-3 py-2 text-sm text-red-pen">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "登录中" : "登录"}
      </Button>
    </form>
  );
}
