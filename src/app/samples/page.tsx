import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "示例合同" };

// 四份示例合同都是虚构的，每份按规则清单埋了几处常见问题。正文在 data/samples/，标准答案在 answers.json；
// T19 接上正文和预先生成的报告。
const SAMPLES = [
  { title: "劳动合同", note: "两年期，试用期、违约金、竞业限制条款有问题" },
  { title: "三方协议", note: "用落户换五年服务期违约金、试用期工资偏低、“最终解释权归甲方所有”" },
  { title: "录用通知", note: "先签试用期合同再签正式合同、扣毕业证、试用期工资低于上海最低工资" },
  { title: "实习协议", note: "工服押金、提前结束实习要批准、不服从调岗视为自动离职" },
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
