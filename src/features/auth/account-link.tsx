"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 页眉右上角：没登录显示"登录"，登录了显示账号名和"退出"。
// 会话 Cookie 是 HttpOnly，页面脚本读不到，所以问 /api/session。页眉放在静态页面里，
// 不在服务端读 Cookie：服务端读了，所有页面都要变成每次现算，示例合同页就不能预渲染了。
export function AccountLink() {
  const [user, setUser] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ user: string | null }>)
      .then((s) => setUser(s.user))
      .catch(() => setUser(null));
  }, []);

  if (!user)
    return (
      <Link href="/login" className="hover:text-ink">
        登录
      </Link>
    );

  return (
    <span className="flex items-center gap-2">
      <span className="max-w-[6rem] truncate text-ink" title={`已登录：${user}`}>
        {user}
      </span>
      <button
        type="button"
        className="hover:text-ink"
        onClick={() => {
          // 退出后回首页；检查页、练习页下次打开会按没登录显示
          void fetch("/api/logout", { method: "POST" }).finally(() => {
            setUser(null);
            router.push("/");
          });
        }}
      >
        退出
      </button>
    </span>
  );
}
