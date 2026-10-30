// 规则引擎的公共类型。结论等级和规划文档《规则清单》第 2 节一一对应。
// 规则函数只吃结构化字段（由抽取步骤给出），不读合同全文；basis 只填条文 ID，原文由界面按 ID 从库里取。

export type Verdict =
  "violation" | "likely_violation" | "needs_review" | "advice" | "ok" | "unknown";

export type Finding = {
  rule: string; // R01 …
  verdict: Verdict;
  title: string; // 一句话结论
  basis: string[]; // 条文 ID，如 ldhtf-19-1
  steps: string[]; // 计算或判断过程，逐步写
  factsNeeded?: string[]; // 还要用户确认的事
  note?: string; // 后果、权益提示
};

/** 结论的严重程度，排序和取最重的结论用 */
export const SEVERITY: Record<Verdict, number> = {
  violation: 5,
  likely_violation: 4,
  needs_review: 3,
  advice: 2,
  unknown: 1,
  ok: 0,
};
