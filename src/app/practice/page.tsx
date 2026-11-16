import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { PracticeRoom } from "@/features/practice/components/practice-room";

export const metadata: Metadata = { title: "谈判练习" };

export default function PracticePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-semibold">谈判练习</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">
          从检查报告里选几条想改的条款，和扮演 HR 的 AI
          练习怎么提出来。旁边的教练每轮给一条提示，只引用报告里的依据；结束后按依据、改法、语气三项复盘。对话不保存。
        </p>
        <div className="mt-6">
          <PracticeRoom />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
