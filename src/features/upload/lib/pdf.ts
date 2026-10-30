// 读 PDF：有文字层的直接取文字和位置，不用识别；扫描件（没有文字层）渲染成图片，走图片识别。
// pdf.js 只在用户选了 PDF 时才加载。

import { groupPdfItems, MIN_TEXT_LAYER_CHARS, type PdfItem, type PdfLine } from "./pdf-lines";

export type PdfPage = { canvas: HTMLCanvasElement; lines: PdfLine[] | null }; // lines 为 null 表示没有文字层

export const MAX_PAGES = 6;

export async function readPdf(file: File): Promise<{ pages: PdfPage[]; totalPages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    // 渲染到长边约 2000 像素，和照片的处理尺寸一致
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2000 / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;

    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str) continue;
      const tx = pdfjs.Util.transform(viewport.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]);
      items.push({ str: it.str, x: tx[4], y: tx[5] - h, w: it.width * viewport.scale, h });
    }
    const chars = items.reduce((n, i) => n + i.str.replace(/\s/g, "").length, 0);
    pages.push({ canvas, lines: chars >= MIN_TEXT_LAYER_CHARS ? groupPdfItems(items) : null });
  }
  return { pages, totalPages: doc.numPages };
}
