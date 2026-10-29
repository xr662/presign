import { cn } from "@/lib/utils";
import { VERDICT_STYLE, type Verdict } from "../verdict";

// 批注卡。内容顺序固定（规划文档《项目方案》第 2 节）：
// 条款出处 → 结论 → 依据 → 计算过程 → 建议改法 → 还要确认的事。
// 依据的法条原文只能来自法规库，这里只负责展示，不接受模型生成的法条文字。

export type LawQuote = {
  id: string; // 条文 ID，如 ldhtf-19-1
  label: string; // 劳动合同法第十九条第一款
  text: string; // 原文，由 get_article 从库里取
};

export type Annotation = {
  clauseNo: string;
  verdict: Verdict;
  conclusion: string;
  basis: LawQuote[];
  steps: string[];
  revision?: { before: string; after: string };
  factsNeeded?: string[];
};

export function AnnotationCard({ a, className }: { a: Annotation; className?: string }) {
  const style = VERDICT_STYLE[a.verdict];
  return (
    <section
      className={cn(
        "rounded-md border border-line border-l-4 bg-card p-4",
        style.borderL,
        className,
      )}
      aria-label={`第 ${a.clauseNo} 条：${style.label}`}
    >
      <header className="flex items-baseline gap-2">
        <span className={cn("rounded-sm px-1.5 py-0.5 text-xs font-medium", style.bg, style.text)}>
          {style.label}
        </span>
        <a href={`#clause-${a.clauseNo}`} className="text-xs text-ink-2 hover:underline">
          第 {a.clauseNo} 条
        </a>
      </header>

      <p className="mt-2 font-medium leading-6">{a.conclusion}</p>

      {a.basis.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-sm text-ink-2 select-none">
            依据：{a.basis.map((b) => b.label).join("、")}
          </summary>
          {a.basis.map((b) => (
            <blockquote
              key={b.id}
              className="mt-2 border-l-2 border-line pl-3 font-law text-sm leading-6 text-ink"
            >
              {b.text}
            </blockquote>
          ))}
        </details>
      )}

      {a.steps.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm text-ink-2 tabular-nums">
          {a.steps.map((s, i) => (
            <li key={i}>
              <span className="mr-1 text-pencil">{i + 1}.</span>
              {s}
            </li>
          ))}
        </ol>
      )}

      {a.revision && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-sm bg-paper-2 p-2">
            <div className="mb-1 text-xs text-ink-2">原文</div>
            <p className="line-through decoration-red-pen/60">{a.revision.before}</p>
          </div>
          <div className="rounded-sm bg-paper-2 p-2">
            <div className="mb-1 text-xs text-ink-2">建议改成</div>
            <p>{a.revision.after}</p>
          </div>
        </div>
      )}

      {a.factsNeeded && a.factsNeeded.length > 0 && (
        <p className="mt-3 text-sm text-orange">还要确认：{a.factsNeeded.join("；")}</p>
      )}
    </section>
  );
}
