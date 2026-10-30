// R05 试用期工资过低（劳动合同法第二十条、实施条例第十五条）。
// 最低工资由调用方按工作地点查好传进来（lookup_min_wage），规则本身是纯函数。

import type { Finding } from "./types.ts";

export function checkProbationWage(input: {
  probationWage: number | null;
  agreedWage?: number | null; // 转正后约定的月工资
  minWage?: { monthly: number; label: string } | null; // label 如"上海市月最低工资 2740 元（截至 2026-10-01）"
}): Finding | null {
  const { probationWage: p, agreedWage: a, minWage: m } = input;
  const basis = ["ldhtf-20-1", "ldhtf-tl-15"];
  if (p == null) return null;
  const steps = [`试用期月工资：${p} 元`];
  if (m) steps.push(`当地月最低工资：${m.label}`);
  if (a) steps.push(`转正后约定工资：${a} 元，80% 是 ${Math.round(a * 0.8)} 元`);

  if (m && p < m.monthly)
    return {
      rule: "R05",
      verdict: "violation",
      title: `试用期工资 ${p} 元，低于当地最低工资 ${m.monthly} 元`,
      basis,
      steps: [...steps, `相差 ${m.monthly - p} 元`],
    };
  if (a && p < a * 0.8)
    return {
      rule: "R05",
      verdict: "likely_violation",
      title: `试用期工资只有约定工资的 ${Math.round((p / a) * 100)}%，低于 80%`,
      basis,
      steps,
      factsNeeded: ["本单位相同岗位最低档工资是多少（法条也允许按它的 80% 算，合同里一般看不到）"],
    };
  if (m && p < m.monthly * 1.1)
    return {
      rule: "R05",
      verdict: "needs_review",
      title: `试用期工资只比当地最低工资高 ${(((p - m.monthly) / m.monthly) * 100).toFixed(1)}%`,
      basis,
      steps,
      factsNeeded: [
        "当地最低工资是否包含个人缴纳的社保和公积金（各地规定不同），扣完以后是否还够最低工资",
      ],
    };
  if (!a && !m)
    return {
      rule: "R05",
      verdict: "unknown",
      title: "缺少转正工资和工作地点，没法判断试用期工资",
      basis,
      steps,
      factsNeeded: ["转正后的月工资", "工作地点（用来查最低工资）"],
    };
  return { rule: "R05", verdict: "ok", title: "试用期工资没有低于法定标准", basis, steps };
}
