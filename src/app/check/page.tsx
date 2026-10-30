import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { Uploader } from "@/features/upload/components/uploader";

export const metadata: Metadata = { title: "上传合同" };

export default function CheckPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-semibold">上传合同</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">
          拍下录用通知、三方协议、实习协议或劳动合同，每页拍一张；PDF 可以直接选；也可以粘贴文字。
        </p>
        <div className="mt-6">
          <Uploader />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
