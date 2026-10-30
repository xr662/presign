// R06 服务期、竞业限制以外由劳动者承担违约金（劳动合同法第二十五条）
// R07 服务期违约金超过培训费用分摊（第二十二条，实施条例第十六条）
// R08 以户口、住房等特殊待遇约定服务期违约金（第二十五条，解释（二）第十二条）
// 只适用于劳动合同及其补充协议、入职承诺书；三方协议的违约金走 R12。

import type { Finding } from "./types.ts";

export type PenaltyTrigger =
  | "service_period"
  | "non_compete"
  | "early_resign"
  | "probation_resign"
  | "notice"
  | "confidentiality"
  | "rules_violation"
  | "other";

const TRIGGER_TEXT: Record<PenaltyTrigger, string> = {
  service_period: "违反服务期",
  non_compete: "违反竞业限制",
  early_resign: "提前离职",
  probation_resign: "试用期内离职",
  notice: "离职没有按要求提前通知",
  confidentiality: "违反保密义务",
  rules_violation: "违反规章制度",
  other: "其他情形",
};

export function checkPenalties(
  penalties: { trigger: PenaltyTrigger; amount?: number | null; quote?: string }[],
): Finding[] {
  return penalties
    .filter((p) => p.trigger !== "service_period" && p.trigger !== "non_compete")
    .map((p) => {
      const amount = p.amount ? `${p.amount} 元` : "违约金";
      const confidential = p.trigger === "confidentiality";
      return {
        rule: "R06",
        verdict: "violation" as const,
        title: `${TRIGGER_TEXT[p.trigger]}要你付${amount}，这条约定无效`,
        basis: confidential ? ["ldhtf-25-1", "ldhtf-90-1"] : ["ldhtf-25-1"],
        steps: [
          `违约金的触发条件：${TRIGGER_TEXT[p.trigger]}`,
          "劳动合同里只有违反服务期（第二十二条）和违反竞业限制（第二十三条）两种情形可以约定由劳动者付违约金",
          "这一条不属于这两种，按第二十五条无效",
        ],
        note: confidential
          ? "保密义务本身有效：违反保密约定给单位造成损失的，仍要赔偿实际损失（第九十条），只是不能事先约定违约金。"
          : undefined,
      };
    });
}

export type ServicePenalty =
  | { kind: "full_cost" } // 离职付全部培训费
  | { kind: "prorated" } // 按未履行月数分摊
  | { kind: "amount"; amount: number };

export function checkServicePeriod(input: {
  trainingKind: "special" | "onboarding" | "unknown"; // 专项技术培训 / 入职或岗前培训 / 没写明
  trainingCost?: number | null;
  serviceMonths?: number | null;
  servedMonths?: number | null; // 已履行月数，报告里举例时用
  penalty: ServicePenalty;
}): Finding {
  const basis = ["ldhtf-22-1", "ldhtf-22-2", "ldhtf-tl-16"];
  const { trainingCost: cost, serviceMonths: total, servedMonths: served } = input;
  const note =
    "因为单位违法（比如不交社保、拖欠工资）你依法解除合同的，不算违反服务期，不用付违约金（实施条例第二十六条第一款）。";
  if (input.trainingKind !== "special")
    return {
      rule: "R07",
      verdict: "needs_review",
      title: "服务期违约金要以单位出钱做专业技术培训为前提，这一条看不出是",
      basis,
      steps: ["第二十二条只允许为提供了专项培训费用、进行专业技术培训的劳动者约定服务期"],
      factsNeeded: ["培训是不是专业技术培训（入职培训、岗前培训不算）", "培训费用多少、有没有凭证"],
      note,
    };
  const steps: string[] = [];
  if (cost) steps.push(`培训费用：${cost} 元`);
  if (total) steps.push(`服务期：${total} 个月`);
  if (cost && total && served != null) {
    const cap = Math.round((cost * (total - served)) / total);
    steps.push(
      `已履行 ${served} 个月时，最多付 ${cost} × ${total - served} ÷ ${total} = ${cap} 元`,
    );
  } else if (cost && total) steps.push(`违约金上限 = ${cost} × 未履行月数 ÷ ${total}`);

  if (input.penalty.kind === "amount" && cost && input.penalty.amount > cost)
    return {
      rule: "R07",
      verdict: "violation",
      title: `服务期违约金 ${input.penalty.amount} 元，超过了培训费用 ${cost} 元`,
      basis,
      steps: [...steps, "第二十二条第二款：违约金不得超过用人单位提供的培训费用"],
      note,
    };
  if (input.penalty.kind === "full_cost")
    return {
      rule: "R07",
      verdict: "violation",
      title: "离职要付全部培训费，超过了按未履行服务期分摊的数额",
      basis,
      steps: [
        ...steps,
        "第二十二条第二款：要求劳动者支付的违约金不得超过服务期尚未履行部分所应分摊的培训费用",
      ],
      note,
    };
  return {
    rule: "R07",
    verdict: "ok",
    title: "服务期违约金按未履行部分分摊，符合第二十二条",
    basis,
    steps,
    note,
  };
}

export function checkSpecialBenefitPenalty(input: {
  benefit: "hukou" | "housing" | "other";
  serviceYears?: number | null;
  amount?: number | null;
}): Finding {
  const what = { hukou: "办理落户", housing: "提供住房", other: "提供特殊待遇" }[input.benefit];
  return {
    rule: "R08",
    verdict: "violation",
    title: `用${what}换服务期，再约定违约金，这条违约金无效`,
    basis: ["ldhtf-25-1", "ldzy-js2-12"],
    steps: [
      `服务期的对价是${what}，不是专项技术培训`,
      "不属于第二十二条、第二十三条可以约定违约金的情形，按第二十五条无效",
      ...(input.amount ? [`约定的违约金 ${input.amount} 元不用付`] : []),
    ],
    note: "但如果你提前离职、又不属于单位违法在先的情形，单位可以要求赔偿实际损失；法院会看损失多少、双方过错和已经工作的年限（解释（二）第十二条）。",
  };
}
