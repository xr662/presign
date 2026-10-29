import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "上传合同" };

// 上传页骨架。T06 接入：拍照和相册（浏览器压缩）、PDF 文字层读取、粘贴文字、打码预览。
export default function CheckPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">上传合同</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          支持照片（最多 6 页）、PDF
          和直接粘贴文字。上传前，身份证号、手机号、银行卡号会先在你的浏览器里打码，你可以再增删打码框。
        </p>

        <div className="mt-6 rounded-md border border-dashed border-line bg-card p-8 text-center">
          <p className="text-sm text-ink-2">把照片或 PDF 拖到这里</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button>拍照</Button>
            <Button variant="outline">从相册或文件选择</Button>
          </div>
        </div>

        <div className="mt-6">
          <label htmlFor="paste" className="text-sm font-medium">
            或者粘贴合同文字
          </label>
          <textarea
            id="paste"
            rows={8}
            className="mt-2 w-full rounded-md border border-line bg-card p-3 text-sm leading-6"
            placeholder="把合同全文粘贴到这里"
          />
          <Button className="mt-3" disabled>
            开始检查
          </Button>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
