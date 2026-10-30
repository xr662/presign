import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SampleReplay } from "@/features/review/components/sample-replay";
import { SAMPLES } from "@/features/review/samples";

export function generateStaticParams() {
  return SAMPLES.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: PageProps<"/samples/[id]">): Promise<Metadata> {
  const { id } = await params;
  const s = SAMPLES.find((x) => x.id === id);
  return { title: s ? `示例：${s.title}` : "示例合同" };
}

// 项目开了 cacheComponents：读 params 的部分放进 Suspense，页头页脚先出来（Next 16 的要求）
export default function SamplePage({ params }: PageProps<"/samples/[id]">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <p className="text-sm">
          <Link href="/samples" className="text-ink-2 hover:underline">
            示例合同
          </Link>
        </p>
        <Suspense fallback={<p className="mt-2 text-sm text-ink-2">正在加载示例合同</p>}>
          <SampleBody params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function SampleBody({ params }: { params: PageProps<"/samples/[id]">["params"] }) {
  const { id } = await params;
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) notFound();
  return (
    <>
      <h1 className="mt-1 text-2xl font-semibold">{s.title}（虚构示例）</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">{s.note}</p>
      <div className="mt-6">
        <SampleReplay id={s.id} title={s.title} />
      </div>
    </>
  );
}
