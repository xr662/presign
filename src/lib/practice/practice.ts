// 谈判练习的材料整理和程序检查（项目方案第 7、8 节）。纯函数，接口和单元测试共用。
// 模型输出不直接给用户看，先过两道程序检查：
// 1. 教练提示里出现的条号，必须在这几条问题的依据里出现过；不在的就换成报告里写好的谈判要点。
// 2. 复盘摘的"原话"必须真的出自用户说过的话；对不上就不显示原话。

import type {
  Coach,
  Debrief,
  DebriefItem,
  PracticeFinding,
  Turn,
} from "@/features/practice/scenario";

const VERDICT_TEXT: Record<string, string> = {
  violation: "违法",
  likely_violation: "可能违法",
  needs_review: "需要确认",
  advice: "提示",
};

const clauseText = (f: PracticeFinding) =>
  f.clause ? (f.clause.startsWith("第") ? f.clause : `第${f.clause}条`) : "全文";

/** HR 看到的材料：只有条款原文和对方可能提的问题，不给依据原文，HR 本来也不一定懂法 */
export function hrMaterial(findings: PracticeFinding[]): string {
  return findings
    .map((f) =>
      [`${clauseText(f)}：${f.quote ?? "（看全文）"}`, `对方可能提的问题：${f.title}`].join("\n"),
    )
    .join("\n\n");
}

/** 教练和复盘看到的材料：检查报告里的结论、改法、谈判要点和依据原文 */
export function coachMaterial(findings: PracticeFinding[]): string {
  return findings
    .map((f) =>
      [
        `[${f.id}] ${clauseText(f)}（${VERDICT_TEXT[f.verdict] ?? f.verdict}）`,
        `合同原文：${f.quote ?? "（看全文）"}`,
        `检查结论：${f.conclusion}`,
        f.revision ? `建议改法：把“${f.revision.before}”改成“${f.revision.after}”` : null,
        f.talkingPoint ? `可以这样说：${f.talkingPoint}` : null,
        ...f.basis.map((b) => `依据 ${b.label}：${b.text}`),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function transcript(history: Turn[]): string {
  return history.map((t) => `${t.role === "me" ? "我" : "HR"}：${t.text}`).join("\n");
}

// 条号：第十九条、第 19 条、第二十条第一款里的"第二十条"
const ARTICLE = /第\s*[一二三四五六七八九十百零〇\d]+\s*条/g;
const norm = (s: string) => s.replace(/\s/g, "");

/** text 里提到的每个条号都在依据里出现过（依据的 label 或原文） */
export function citesOnlyBasis(text: string, findings: PracticeFinding[]): boolean {
  const known = findings.flatMap((f) => f.basis.map((b) => norm(b.label + b.text)));
  return (text.match(ARTICLE) ?? []).every((a) => known.some((k) => k.includes(norm(a))));
}

export function checkCoach(c: Coach, findings: PracticeFinding[]): Coach {
  const findingId = findings.some((f) => f.id === c.findingId) ? c.findingId : null;
  if (citesOnlyBasis(c.hint, findings)) return { ...c, findingId };
  // 提示引用了报告里没有的条号：不显示模型的话，换成报告里写好的谈判要点
  const f = findings.find((x) => x.id === findingId) ?? findings[0];
  return {
    hint: f?.talkingPoint ?? "先说清楚是哪一条、依据是哪条规定，再说你希望怎么改。",
    findingId: f?.id ?? null,
    tone: c.tone,
  };
}

export function checkDebrief(d: Debrief, history: Turn[]): Debrief {
  const mine = history.filter((t) => t.role === "me").map((t) => norm(t.text));
  const keys: DebriefItem["key"][] = ["basis", "revision", "tone"];
  return {
    summary: d.summary,
    // 三项各取一条，缺的不补；分数夹在 1~5
    items: keys.flatMap((k) => {
      const it = d.items.find((x) => x.key === k);
      if (!it) return [];
      const q = it.quote && mine.some((m) => m.includes(norm(it.quote!))) ? it.quote : null;
      return [{ ...it, score: Math.min(5, Math.max(1, Math.round(it.score))), quote: q }];
    }),
  };
}

// 练习输入的内容过滤（项目方案第 8 节）：先过关键词表，命中就不发给模型。
// 词表只放明显不适合练习的辱骂和暴力用语，正常的激烈措辞（"这不合理""我不签"）不拦。
const BLOCKED = ["傻逼", "操你", "他妈的", "去死", "杀了你", "弄死你", "炸死", "砍死"];

/** 返回不能发送的原因；没问题返回 null */
export function screenInput(text: string): string | null {
  const t = norm(text);
  if (!t) return "先写一句再发送。";
  if (BLOCKED.some((w) => t.includes(w)))
    return "这句话里有辱骂或威胁的用语，换个说法再试。真实谈判里这样说会让对方直接结束沟通。";
  return null;
}
