// PDF 文字层 → 行。pdf.js 给出的是一段段文字和各自的位置，同一行常被拆成好几段，
// 这里按基线高度把它们归到同一行，再按横坐标排好拼起来。坐标已经换算成页面渲染图上的像素。

import type { Box } from "./align";

export type PdfItem = { str: string; x: number; y: number; w: number; h: number }; // 左上角原点
export type PdfLine = { text: string; box: Box };

export function groupPdfItems(items: PdfItem[]): PdfLine[] {
  const rows: { cy: number; h: number; items: PdfItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const cy = it.y + it.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) < Math.min(r.h, it.h) * 0.5);
    if (row) row.items.push(it);
    else rows.push({ cy, h: it.h, items: [it] });
  }
  return rows
    .sort((a, b) => a.cy - b.cy)
    .map((r) => {
      const its = r.items.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = -Infinity;
      for (const it of its) {
        // 两段之间空得多（超过一个字宽）就补一个空格，英文和数字靠它分词
        if (text && it.x - prevEnd > it.h * 0.9) text += " ";
        text += it.str;
        prevEnd = it.x + it.w;
      }
      const box: Box = [
        Math.min(...its.map((i) => i.x)),
        Math.min(...its.map((i) => i.y)),
        Math.max(...its.map((i) => i.x + i.w)),
        Math.max(...its.map((i) => i.y + i.h)),
      ];
      // 标题常用字间距排开（"录 用 通 知 书"），两个汉字之间的空格去掉；英文和数字之间的保留
      text = text.replace(/(?<=[一-鿿])\s+(?=[一-鿿])/g, "").trim();
      return { text, box };
    });
}

/** 每页少于这么多字，当作扫描件（没有文字层），改走图片识别 */
export const MIN_TEXT_LAYER_CHARS = 30;
