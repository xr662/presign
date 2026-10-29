import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "示例合同" };

// 四份示例合同都是虚构的，每份按规则清单埋了几处常见问题。T19 做出正文和预先生成的报告。
const SAMPLES = [
  { title: "劳动合同", note: "两年期，试用期、违约金、竞业限制条款有问题" },
  { title: "三方协议", note: "违约金和“最终解释权归公司所有”这类格式条款" },
  { title: "录用通知", note: "先签试用期合同、转正再签正式合同" },
  { title: "实习协议", note: "押金、辞职需批准、单方调岗" },
] as const;

export default function SamplesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">示例合同</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          没有合同在手边，可以用这几份虚构的合同看看检查结果。
        </p>
        <ul className="mt-6 divide-y divide-line rounded-md border border-line bg-card">
          {SAMPLES.map((s) => (
            <li key={s.title} className="px-4 py-3">
              <div className="font-medium">{s.title}</div>
              <div className="mt-0.5 text-sm text-ink-2">{s.note}</div>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
