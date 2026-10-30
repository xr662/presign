// 自检里由程序做的部分（项目方案第 4 节第 5 步），以及报告文字的把关。纯函数，不调模型。
// 模型核对字段和原文是否一致，程序核对能机械判断的：出处在不在合同里、依据在不在库里、
// 检索结论的依据是不是这一条自己的检索结果、报告里的数字是不是前面步骤给过的。

import type { ReviewFinding, Revision, Verdict } from "./events.ts";
import { containsQuote } from "./text.ts";

export type CheckContext = {
  /** 合同全文 */
  text: string;
  /** 检索结论：这一条自己的候选条文 ID */
  candidates?: Set<string>;
};

/** 返回没通过的原因；通过返回 null */
export function programCheck(f: ReviewFinding, ctx: CheckContext): string | null {
  if (f.quote !== null && !containsQuote(ctx.text, f.quote)) return "引用的原文在合同里找不到";
  if (f.basis.length === 0) return "没有依据条文";
  const empty = f.basis.find((b) => !b.text);
  if (empty) return `依据条文 ${empty.id} 在法规库里取不到原文`;
  if (f.source === "model") {
    if (!ctx.candidates) return "缺少这一条的检索结果，无法核对依据";
    const outside = f.basis.find((b) => !ctx.candidates!.has(b.id));
    if (outside) return `依据 ${outside.id} 不在这一条的检索结果里`;
    if (f.verdict === "violation") return "模型判断的结论最高到“可能违法”";
  }
  return null;
}

// ── 报告文字把关 ────────────────────────────────────────

// 敬称、全角感叹号、破折号用字符编码拼出来：文案检查（scripts/copy-lint.mjs）按源码字面查，
// 直接写会被当成违规文案；写成 \u 转义也不行，prettier 会把转义还原成原字符
export const HONORIFIC = String.fromCharCode(0x60a8);
const FULL_BANG = String.fromCharCode(0xff01);
const DOUBLE_DASH = String.fromCharCode(0x2014).repeat(2);

/** 写作规范里能机械修正的几条：敬称换成"你"，去掉感叹号和破折号 */
export function tidy(s: string): string {
  return s
    .replaceAll(HONORIFIC, "你")
    .replaceAll(FULL_BANG, "。")
    .replace(/!/g, "")
    .replaceAll(DOUBLE_DASH, "，")
    .replace(/。。+/g, "。")
    .trim();
}

const numbersIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * 报告里出现的数字必须在这条批注的材料里出现过（结论、计算过程、原文、依据原文、提示）。
 * 模型自己算的数、记错的条号都会被拦下来。返回第一个对不上的数字，都对得上返回 null。
 */
export function strayNumber(written: string, f: ReviewFinding): string | null {
  const material = [
    f.title,
    f.quote ?? "",
    f.note ?? "",
    ...f.steps,
    ...f.factsNeeded,
    ...f.basis.flatMap((b) => [b.label, b.text]),
  ].join("\n");
  const known = new Set(numbersIn(material));
  return numbersIn(written).find((n) => !known.has(n)) ?? null;
}

/** 修改稿的 before 必须摘自合同原文，摘不到的不显示修改稿 */
export function revisionOk(r: Revision | null, text: string): boolean {
  return r !== null && r.before.trim().length > 0 && containsQuote(text, r.before);
}

/** 汇总一句：按等级计数，写作规范第 3 节的写法 */
export function summarize(counts: Record<Verdict, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return "没有找到可以检查的条款。";
  const parts = (
    [
      ["violation", "违法"],
      ["likely_violation", "可能违法"],
      ["needs_review", "需要确认"],
      ["advice", "提示"],
      ["unknown", "信息不足"],
      ["ok", "没有问题"],
    ] as const
  )
    .filter(([v]) => counts[v] > 0)
    .map(([v, label]) => `${counts[v]} 项${label}`);
  return `检查了 ${total} 项：${parts.join("，")}。`;
}
