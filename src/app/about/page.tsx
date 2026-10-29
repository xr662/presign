import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "说明" };

// 说明页骨架。隐私说明的每一项要能对到代码里的存储位置，T19 定稿时逐项核对后再写全。
export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 leading-7">
        <h1 className="text-2xl font-semibold">说明</h1>

        <h2 className="mt-8 text-lg font-semibold">怎么检查</h2>
        <p className="mt-2 text-ink-2">
          大模型负责读懂合同、找出相关条款；试用期上限、违约金能不能约定这类有明确规定的问题，由程序按法条计算。每条结论都附上法条原文，原文从法规库里取，不由模型生成。
        </p>

        <h2 className="mt-8 text-lg font-semibold">法条来源</h2>
        <p className="mt-2 text-ink-2">
          劳动合同法、劳动合同法实施条例、最高人民法院两部劳动争议司法解释、民法典相关条文，以及人社部公布的各地最低工资标准。每条法条都记录了来源网址和施行日期。
        </p>

        <h2 className="mt-8 text-lg font-semibold">隐私</h2>
        <p className="mt-2 text-ink-2">服务器不保存合同原文、照片和对话。</p>

        <h2 className="mt-8 text-lg font-semibold">免责声明</h2>
        <p className="mt-2 text-ink-2">
          检查结果是风险提示，不构成法律意见。涉及具体纠纷，请咨询律师或拨打 12348
          公共法律服务热线。
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
