// 谈判练习的场景（项目方案第 7 节）：从检查报告里取出有问题的条款，用户选 1~3 条去和 HR 谈。
// 只有类型和纯函数，浏览器和服务端共用。服务端不存对话：每轮由浏览器把场景、历史和本轮输入一起发来。

import type { FindingView } from "@/features/review/state";
import type { Verdict } from "@/lib/review/events";

export type PracticeStyle = "soft" | "formal" | "tough";

export const STYLES: { id: PracticeStyle; label: string; desc: string; opener: string }[] = [
  {
    id: "soft",
    label: "好商量",
    desc: "愿意听你说，会问你想怎么改",
    opener: "你好，合同你看过了吧？哪里有疑问可以直接说，我们一起看看。",
  },
  {
    id: "formal",
    label: "公事公办",
    desc: "强调公司统一模板和流程，改条款要请示",
    opener: "你好。合同是公司统一模板，你如果对条款有意见，具体说是哪一条。",
  },
  {
    id: "tough",
    label: "强势",
    desc: "会说别人都这么签，催你尽快决定",
    opener: "合同都是统一的，其他同学基本都签了。你还有什么问题？我这边今天要收齐。",
  },
];

/** 一条要谈的问题。字段都取自检查报告，HR 和教练只能用这些材料 */
export type PracticeFinding = {
  id: string;
  verdict: Verdict;
  clause: string | null;
  quote: string | null;
  title: string;
  conclusion: string;
  revision: { before: string; after: string } | null;
  talkingPoint: string | null;
  basis: { label: string; text: string }[];
};

export type Scenario = { docKind: string; findings: PracticeFinding[] };

export type Turn = { role: "me" | "hr"; text: string };

/** 教练每轮一张提示卡。tone 是对你上一句话语气的判断 */
export type Coach = {
  hint: string;
  findingId: string | null;
  tone: "steady" | "too_soft" | "too_hard" | null;
};

export type DebriefItem = {
  key: "basis" | "revision" | "tone";
  score: number;
  comment: string;
  /** 你说过的原话，程序核对过确实出自对话 */
  quote: string | null;
};

export type Debrief = { items: DebriefItem[]; summary: string };

export const DEBRIEF_LABELS: Record<DebriefItem["key"], string> = {
  basis: "依据讲清楚了吗",
  revision: "提出具体改法了吗",
  tone: "语气稳妥吗",
};

/**
 * HR 的流式回复中途断了，服务端在末尾补这个字符，浏览器据此提示"没说完"并把它去掉。
 * 用 fromCharCode：prettier 会把源码里的 \u 转义还原成看不见的原字符（交接文档第 8 节）
 */
export const CUT_MARK = String.fromCharCode(0x2063);

/** 一次练习最多几轮（你说一句、HR 回一句算一轮），控制模型调用次数 */
export const MAX_ROUNDS = 8;
export const MAX_PICK = 3;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** 从检查结果里取出能谈的条款：有问题的（不含 ok），依据原文截短，免得请求太大 */
export function scenarioFromFindings(docKind: string | null, findings: FindingView[]): Scenario {
  return {
    docKind: docKind ?? "合同",
    findings: findings
      .filter((f) => f.verdict !== "ok" && f.verdict !== "unknown")
      .slice(0, 12)
      .map((f) => ({
        id: f.id,
        verdict: f.verdict,
        clause: f.clause,
        quote: f.quote ? clip(f.quote, 300) : null,
        title: clip(f.title, 120),
        conclusion: clip(f.report?.conclusion ?? f.title, 300),
        revision: f.report?.revision
          ? {
              before: clip(f.report.revision.before, 300),
              after: clip(f.report.revision.after, 300),
            }
          : null,
        talkingPoint: f.report?.talkingPoint ? clip(f.report.talkingPoint, 200) : null,
        basis: f.basis.slice(0, 3).map((b) => ({ label: b.label, text: clip(b.text, 400) })),
      })),
  };
}

// 检查页点"练习怎么谈"时存一份，练习页读出来。只放在这个标签页的 sessionStorage 里，关掉就没了
const KEY = "presign:practice";

export function saveScenario(s: Scenario) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 隐私模式等存不了时，练习页会让用户改选示例合同
  }
}

/**
 * 给 useSyncExternalStore 用：返回原始字符串而不是解析后的对象。
 * 快照每次都要是同一个值，返回新对象会让 React 以为数据一直在变、反复重渲染
 */
export function readScenarioRaw(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseScenario(raw: string | null): Scenario | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Scenario;
  } catch {
    return null;
  }
}
