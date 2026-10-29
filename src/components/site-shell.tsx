import Link from "next/link";

// 全站页眉页脚。导航只放用户真正要去的三处；免责声明放页脚，每页都在。

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-law text-xl font-semibold tracking-wider">
          签前
        </Link>
        <nav className="flex items-center gap-5 text-sm text-ink-2">
          <Link href="/samples" className="hover:text-ink">
            示例合同
          </Link>
          <Link href="/about" className="hover:text-ink">
            说明
          </Link>
          <Link href="/login" className="hover:text-ink">
            登录
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs leading-5 text-ink-2">
        <p>检查结果是风险提示，不构成法律意见。拿不准的问题可以拨打 12348 公共法律服务热线。</p>
        <p className="mt-1">
          法条来自国家机关公开发布的文本，每条结论都标明出处。
          <Link href="/about" className="underline underline-offset-2">
            数据来源与隐私说明
          </Link>
        </p>
      </div>
    </footer>
  );
}
