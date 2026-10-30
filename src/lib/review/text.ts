// 核对原文片段用的文本归一化。识别出的文字和模型摘的片段在空格、全角半角、中英文标点上常有出入，
// 比较前统一掉，内容不同才算对不上。

const FULL_TO_HALF = /[０-９Ａ-Ｚａ-ｚ]/g;
const PUNCT: Record<string, string> = {
  ",": "，",
  ";": "；",
  ":": "：",
  "(": "（",
  ")": "）",
  "?": "？",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
};

export function normalize(s: string): string {
  return s
    .replace(FULL_TO_HALF, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,;:()?“”‘’]/g, (c) => PUNCT[c] ?? c)
    .replace(/[\s　]+/g, "");
}

/** 片段（归一化后）是否原样出现在全文里 */
export function containsQuote(text: string, quote: string): boolean {
  const q = normalize(quote);
  return q.length > 0 && normalize(text).includes(q);
}

/** 两个片段是否说的是同一处：一个包含另一个（归一化后） */
export function sameSpot(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}
