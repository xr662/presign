import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { AnnotationCard } from "@/features/review/components/annotation-card";
import { CheckLog } from "@/features/review/components/check-log";
import { Clause, PaperSheet } from "@/features/review/components/paper-sheet";
import { CHECK_SCOPE } from "@/features/review/check-scope";
import { DEMO_ANNOTATIONS, DEMO_CLAUSES, DEMO_LOG } from "@/features/review/demo";

// 首页：第一屏让人看到"合同 + 批注"本身，而不是产品介绍。
export default function HomePage() {
  const marked = new Set(DEMO_ANNOTATIONS.map((a) => a.clauseNo));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4">
        <section className="py-12 sm:py-16">
          <h1 className="max-w-2xl text-2xl leading-tight font-semibold text-balance sm:text-4xl">
            签字之前，先把合同过一遍
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-ink-2">
            上传录用通知、三方协议、实习协议或劳动合同，逐条检查 {CHECK_SCOPE.length}{" "}
            类常见问题，每条结论附法条原文和计算过程。看完报告，可以和扮演 HR 的 AI
            练习怎么提出修改。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/check">上传合同</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/samples">用示例合同试试</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="demo-title" className="pb-14">
          <h2 id="demo-title" className="mb-4 text-sm text-ink-2">
            示例报告（虚构的劳动合同）
          </h2>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[auto_1fr]">
            <PaperSheet title="劳动合同（节选）">
              {DEMO_CLAUSES.map((c) => (
                <Clause key={c.no} no={c.no} marked={marked.has(c.no) ? "violation" : undefined}>
                  {c.text}
                </Clause>
              ))}
            </PaperSheet>
            {/* 宽屏时批注占右栏两行，检查记录补到合同下方的空处；手机上按 DOM 顺序排：合同、批注、记录 */}
            <div className="space-y-4 lg:row-span-2">
              {DEMO_ANNOTATIONS.map((a) => (
                <AnnotationCard key={a.clauseNo} a={a} />
              ))}
            </div>
            <div className="lg:col-start-1">
              <h3 className="mb-3 text-sm text-ink-2">检查记录</h3>
              <CheckLog entries={DEMO_LOG} />
            </div>
          </div>
        </section>

        <section aria-labelledby="scope-title" className="border-t border-line py-12">
          <h2 id="scope-title" className="text-xl font-semibold">
            检查范围
          </h2>
          <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {CHECK_SCOPE.map((s) => (
              <li key={s.name} className="text-sm leading-6">
                {s.name}
                <span className="block text-xs text-ink-2">{s.basis}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
