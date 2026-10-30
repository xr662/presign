// R09 竞业限制（劳动合同法第二十三、二十四条，解释（一）第三十六至四十条，解释（二）第十三、十四条）。
// 逐项检查，可以同时报几条。

import type { Finding } from "./types.ts";

export function checkNonCompete(input: {
  present: boolean;
  durationMonths?: number | null;
  compensation: "none" | "agreed" | "unknown";
  role?: string | null;
  // senior：高管、高级技术人员、负有保密义务的人员；ordinary：应届生、普通岗位
  roleLevel: "senior" | "ordinary" | "unknown";
  duringEmploymentOnly?: boolean; // 只限制在职期间
}): Finding[] {
  if (!input.present) return [];
  // 在职期间的竞业限制，对高管和核心技术人员有效，不单独报（解释（二）第十四条），避免误报
  if (input.duringEmploymentOnly && input.roleLevel === "senior") return [];
  const out: Finding[] = [];
  const d = input.durationMonths;
  if (d != null && d > 24)
    out.push({
      rule: "R09",
      verdict: "violation",
      title: `竞业限制最长 2 年，这里写了 ${d % 12 === 0 ? `${d / 12} 年` : `${d} 个月`}，超出的部分无效`,
      basis: ["ldhtf-24"],
      steps: [
        `约定期限：离职后 ${d} 个月`,
        "第二十四条第二款：竞业限制期限不得超过二年",
        `超出 ${d - 24} 个月`,
      ],
      factsNeeded: input.roleLevel === "unknown" ? ["你的岗位会不会接触公司的商业秘密"] : undefined,
    });
  if (input.compensation === "none" && !input.duringEmploymentOnly)
    out.push({
      rule: "R09",
      verdict: "advice",
      title: "没有约定离职后的经济补偿",
      basis: ["ldhtf-23-2", "ldzy-js1-36"],
      steps: ["第二十三条：约定竞业限制的，应当在离职后按月给予经济补偿", "合同里没有写补偿"],
      note: "条款不会因此无效。你离职后遵守了竞业限制，可以按离职前十二个月平均工资的 30% 按月要求补偿，低于当地最低工资的按最低工资算（解释（一）第三十六条）。离职后单位连续 3 个月没付补偿，你可以要求解除竞业限制（解释（一）第三十八条）。",
    });
  if (input.roleLevel === "ordinary" && !input.duringEmploymentOnly)
    out.push({
      rule: "R09",
      verdict: "needs_review",
      title: `${input.role ?? "这个岗位"}不一定在竞业限制的适用范围内`,
      basis: ["ldhtf-24", "ldzy-js2-13"],
      steps: [
        "第二十四条：竞业限制只适用于高级管理人员、高级技术人员和其他负有保密义务的人员",
        "解释（二）第十三条：没有知悉、接触商业秘密的劳动者，可以请求确认竞业限制条款不生效",
      ],
      factsNeeded: ["工作中会不会接触公司的商业秘密、核心技术"],
    });
  return out;
}
