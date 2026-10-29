import type { Metadata, Viewport } from "next";
import "./globals.css";

// 不引入网页字体（shadcn 初始化会自动加 Geist，已去掉）：中文字体文件动辄几 MB，
// 服务器出口只有 2M，用户打开首页就要多等十几秒。字体栈在 globals.css 里，全部用系统字体。

export const metadata: Metadata = {
  title: {
    default: "签前",
    template: "%s · 签前",
  },
  description:
    "毕业生签约前的合同检查：逐条检查试用期、违约金、社保、竞业限制等条款，每条结论附法条原文；再和扮演 HR 的 AI 练习怎么提出修改。",
};

export const viewport: Viewport = {
  themeColor: "#FAF7F0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
