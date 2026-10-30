// 在合同的逐行文字里找批注引用的那段原文，检查页据此给行加批注色、点批注卡时滚动过去。
// 识别出的行和模型摘的片段断行不同：片段可能从一行中间开始、跨到下一行，所以三种情况都算：
// 这一行整个在片段里；片段整个在这一行里；片段的开头或结尾几个字在这一行里。

import { normalize } from "@/lib/review/text";

const EDGE = 8;

export function locateLines(lines: string[], quote: string | null): number[] {
  if (!quote) return [];
  const q = normalize(quote);
  if (q.length < 2) return [];
  const head = q.slice(0, EDGE);
  const tail = q.slice(-EDGE);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    const n = normalize(line);
    if (n.length < 2) return;
    if (q.includes(n) || n.includes(q)) hits.push(i);
    else if (q.length > EDGE && (n.includes(head) || n.includes(tail))) hits.push(i);
  });
  return hits;
}
