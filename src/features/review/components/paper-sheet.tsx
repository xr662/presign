import { cn } from "@/lib/utils";
import { VERDICT_STYLE, type Verdict } from "../verdict";

// 合同纸面：整个产品的视觉中心。合同像一张纸摊在桌上，问题条款用批注色划出来。

export function PaperSheet({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-sm border border-line bg-card px-6 py-7 shadow-[0_1px_2px_rgba(31,29,26,0.06),0_8px_24px_-12px_rgba(31,29,26,0.18)] sm:px-10",
        className,
      )}
    >
      {title && (
        <h2 className="mb-5 text-center font-law text-lg font-semibold tracking-wide">{title}</h2>
      )}
      <div className="space-y-3 text-[15px] leading-7">{children}</div>
    </article>
  );
}

// 单条条款。marked 时整段加批注底色和左边线；编号让批注卡能指回原文（"第 3 条"）。
export function Clause({
  no,
  children,
  marked,
  active,
}: {
  no: string;
  children: React.ReactNode;
  marked?: Verdict;
  active?: boolean;
}) {
  const style = marked ? VERDICT_STYLE[marked] : null;
  return (
    <p
      id={`clause-${no}`}
      className={cn(
        "-mx-2 rounded-sm border-l-2 border-transparent px-2",
        style && [style.bg, style.border],
        active && "ring-1 ring-ink/20",
      )}
    >
      <span className="mr-1 font-medium text-ink-2">第 {no} 条</span>
      {children}
    </p>
  );
}
