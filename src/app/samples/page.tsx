import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SAMPLES } from "@/features/review/samples";

export const metadata: Metadata = { title: "示例合同" };

// 四份示例合同都是虚构的，每份按规则清单埋了几处常见问题。点进去回放一次真实检查的过程。
export default function SamplesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">示例合同</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          没有合同在手边，可以用这几份虚构的合同看看检查过程和结果。
        </p>
        <ul className="mt-6 divide-y divide-line rounded-md border border-line bg-card">
          {SAMPLES.map((s) => (
            <li key={s.id}>
              <Link href={`/samples/${s.id}`} className="block px-4 py-3 hover:bg-paper-2">
                <div className="font-medium">{s.title}</div>
                <div className="mt-0.5 text-sm text-ink-2">{s.note}</div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
