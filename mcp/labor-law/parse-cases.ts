// 典型案例切分：最高法的案例页按"案例一 → 标题 → 【基本案情】【裁判结果】【典型意义】"排版。
// 每个案例切成三段，检索命中某一段时能直接显示这段，不用把整个案例塞给模型。

import { parseChineseNumeral } from "./cn-number.ts";

export type CaseSection = { kind: "facts" | "result" | "meaning"; heading: string; text: string };
export type Case = { no: number; title: string; sections: CaseSection[] };

const CASE_HEAD = /^案例([一二三四五六七八九十]+)$/;
const SECTION_HEAD: Record<string, CaseSection["kind"]> = {
  "【基本案情】": "facts",
  "【裁判结果】": "result",
  "【典型意义】": "meaning",
};
const TAIL = /^(相关链接|责任编辑|【?打印|关闭窗口)/;

export function parseCases(lines: string[]): Case[] {
  const cases: Case[] = [];
  let cur: Case | null = null;
  let sec: CaseSection | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (TAIL.test(line) && cur) break;
    const head = line.match(CASE_HEAD);
    if (head) {
      cur = { no: parseChineseNumeral(head[1]), title: "", sections: [] };
      cases.push(cur);
      sec = null;
      continue;
    }
    if (!cur) continue;
    if (line in SECTION_HEAD) {
      sec = { kind: SECTION_HEAD[line], heading: line.slice(1, -1), text: "" };
      cur.sections.push(sec);
      continue;
    }
    if (!sec) {
      // 案例号和【基本案情】之间的一行是标题
      cur.title = cur.title ? cur.title + line : line;
    } else {
      sec.text = sec.text ? sec.text + "\n" + line : line;
    }
  }
  return cases;
}
