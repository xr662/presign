// R10 收押金、扣证件、要求担保（第九条、第八十四条）
// R11 缺少必备条款（第十七条、第八十一条）
// R12 三方协议违约金与格式条款（民法典第四百九十六至四百九十八条、第五百八十五条）
// R13 约定不缴社保（解释（二）第十九条）
// R14 单方变更合同内容（第三十五条、第二十六条）
// R15 法定情形以外的解除条件（第二十一条、第三十九至四十一条、第八十七条）
// R16 限制劳动者辞职（第三十七条、第二十六条）

import type { Finding } from "./types.ts";

export type DepositItem =
  "deposit" | "guarantee" | "keep_original_certificate" | "prepay_fee" | "verify_original";

export function checkDeposit(items: { kind: DepositItem; amount?: number | null }[]): Finding[] {
  const text: Record<Exclude<DepositItem, "verify_original">, string> = {
    deposit: "交押金、保证金",
    guarantee: "提供担保",
    keep_original_certificate: "把身份证、毕业证或学位证原件交给公司保管",
    prepay_fee: "预交培训费或其他费用",
  };
  return items
    .filter((i) => i.kind !== "verify_original") // 只核验原件是可以的
    .map((i) => ({
      rule: "R10",
      verdict: "violation" as const,
      title: `要求${text[i.kind as Exclude<DepositItem, "verify_original">]}，违反第九条`,
      basis: ["ldhtf-9-1", "ldhtf-84"],
      steps: [
        `文书要求：${text[i.kind as Exclude<DepositItem, "verify_original">]}${i.amount ? ` ${i.amount} 元` : ""}`,
        "第九条：不得扣押劳动者的证件，不得要求提供担保或者以其他名义收取财物",
      ],
      note: "劳动行政部门会责令退还；扣证件的，单位要承担赔偿责任（第八十四条）。入职时出示原件核验是可以的。",
    }));
}

export const REQUIRED_ITEMS = {
  employer: "用人单位的名称、住所和法定代表人",
  employee: "劳动者的姓名、住址和身份证号",
  term: "劳动合同期限",
  job: "工作内容和工作地点",
  hours: "工作时间和休息休假",
  pay: "劳动报酬",
  social_insurance: "社会保险",
  protection: "劳动保护、劳动条件和职业危害防护",
} as const;
export type RequiredItem = keyof typeof REQUIRED_ITEMS;

export function checkRequiredClauses(input: {
  docKind: string;
  present: Partial<Record<RequiredItem, boolean>>;
}): Finding | null {
  // 只查劳动合同；录用通知、三方协议不要求这些条款
  if (input.docKind !== "劳动合同") return null;
  const missing = (Object.keys(REQUIRED_ITEMS) as RequiredItem[]).filter((k) => !input.present[k]);
  const basis = ["ldhtf-17-1", "ldhtf-81"];
  if (missing.length === 0)
    return { rule: "R11", verdict: "ok", title: "第十七条要求的必备条款都有", basis, steps: [] };
  return {
    rule: "R11",
    verdict: "violation",
    title: `缺少 ${missing.length} 项必备条款：${missing.map((k) => REQUIRED_ITEMS[k]).join("、")}`,
    basis,
    steps: missing.map((k) => `没有找到：${REQUIRED_ITEMS[k]}`),
    note: "可以要求补上。劳动行政部门会责令改正，给劳动者造成损害的，单位要赔偿（第八十一条）。",
  };
}

export function checkTripartite(input: {
  penalties: { party: "student" | "employer"; amount: number }[];
  monthlyWage?: number | null;
  standardTerms: string[]; // 预先拟定、加重学生责任的条款原文，如"最终解释权归甲方所有"
}): Finding[] {
  const out: Finding[] = [];
  const mine = input.penalties.filter((p) => p.party === "student");
  const theirs = input.penalties.filter((p) => p.party === "employer");
  for (const p of mine) {
    const steps = [`你违约要付 ${p.amount} 元`];
    if (input.monthlyWage)
      steps.push(
        `相当于 ${(p.amount / input.monthlyWage).toFixed(1)} 个月工资（按月薪 ${input.monthlyWage} 元算）`,
      );
    if (theirs.length)
      steps.push(`单位违约只付 ${theirs.map((t) => t.amount).join("、")} 元，双方不对等`);
    out.push({
      rule: "R12",
      verdict: "advice",
      title: `三方协议约定你违约要付 ${p.amount} 元`,
      basis: ["mfd-585-2"],
      steps,
      note: "三方协议可以约定违约金。约定的数额过分高于单位实际损失的，可以请求仲裁机构或法院适当减少（民法典第五百八十五条第二款）。签之前可以要求降低或者改成双方对等。",
    });
  }
  for (const t of input.standardTerms)
    out.push({
      rule: "R12",
      verdict: "needs_review",
      title: `"${t}"是单位预先拟好的格式条款`,
      basis: ["mfd-496", "mfd-497", "mfd-498"],
      steps: [
        "民法典第四百九十六条：提供格式条款的一方要提示、说明与对方有重大利害关系的条款",
        "第四百九十七条：不合理地免除或减轻己方责任、加重对方责任、限制对方主要权利的格式条款无效",
        "第四百九十八条：对格式条款有两种以上解释的，应当作不利于提供格式条款一方的解释",
      ],
      factsNeeded: ["单位有没有就这一条向你作过提示和说明"],
    });
  return out;
}

export function checkSocialInsurance(input: {
  waived: boolean;
  subsidy?: number | null;
}): Finding | null {
  if (!input.waived) return null;
  return {
    rule: "R13",
    verdict: "violation",
    title: "约定不缴社保无效",
    basis: ["ldzy-js2-19-1", "ldzy-js2-19-2"],
    steps: [
      `文书约定不缴社会保险${input.subsidy ? `，改发每月 ${input.subsidy} 元补贴` : ""}`,
      "解释（二）第十九条第一款：约定或者承诺无需缴纳社会保险费的，人民法院应当认定无效",
    ],
    note: "单位没缴社保，你可以据此解除合同并要求经济补偿；单位之后补缴了，可以要求你退回已经领的社保补贴（解释（二）第十九条第二款）。",
  };
}

export function checkUnilateralChange(input: {
  changes: ("position" | "location" | "wage")[];
  wageCut?: boolean;
  refuseMeansResign?: boolean;
}): Finding | null {
  if (input.changes.length === 0) return null;
  const what = input.changes
    .map((c) => ({ position: "岗位", location: "工作地点", wage: "工资" })[c])
    .join("、");
  const severe = input.wageCut || input.refuseMeansResign;
  return {
    rule: "R14",
    verdict: severe ? "violation" : "likely_violation",
    title: severe
      ? `单位可以单方调整${what}${input.refuseMeansResign ? "，不服从就算自动离职" : "并降薪"}`
      : `单位可以单方调整${what}`,
    basis: ["ldhtf-35", "ldhtf-26-1"],
    steps: [
      "第三十五条：变更劳动合同约定的内容，应当协商一致，采用书面形式",
      severe
        ? "这一条排除了你的协商权利，属于第二十六条第一款第二项的情形"
        : "这一条把变更权交给单位一方",
    ],
    factsNeeded: severe ? undefined : ["调整后待遇是否降低、有没有合理的经营理由"],
    note: "法院对不降薪、有合理理由的调岗会认可，所以没写降薪的情形标成可能违法。",
  };
}

export function checkTerminationConditions(
  conditions: { kind: "statutory" | "probation_at_will" | "other"; text: string }[],
): Finding[] {
  return conditions
    .filter((c) => c.kind !== "statutory")
    .map((c) =>
      c.kind === "probation_at_will"
        ? {
            rule: "R15",
            verdict: "violation" as const,
            title: "试用期内不能随时、不说理由地解除合同",
            basis: ["ldhtf-21", "ldhtf-39", "ldhtf-87"],
            steps: [
              `约定：${c.text}`,
              "第二十一条：试用期内，只有第三十九条和第四十条第一项、第二项的情形才能解除，并且要向劳动者说明理由",
            ],
            note: "违法解除的，单位要按经济补偿标准的二倍支付赔偿金（第八十七条）。",
          }
        : {
            rule: "R15",
            verdict: "likely_violation" as const,
            title: `"${c.text}"不在法定可以解除的情形里`,
            basis: ["ldhtf-39", "ldhtf-40", "ldhtf-41", "ldhtf-87"],
            steps: [
              "单位单方解除合同的理由要在第三十九条、第四十条、第四十一条的范围内",
              `约定的理由：${c.text}`,
            ],
            note: "违法解除的，单位要按经济补偿标准的二倍支付赔偿金（第八十七条）。",
          },
    );
}

export function checkResignation(input: {
  noticeDays?: number | null;
  probationNoticeDays?: number | null;
  needsApproval?: boolean;
  penaltyOrDeduction?: boolean;
}): Finding[] {
  const out: Finding[] = [];
  const basis = ["ldhtf-37-1", "ldhtf-26-1"];
  if (input.noticeDays != null && input.noticeDays > 30)
    out.push({
      rule: "R16",
      verdict: "violation",
      title: `辞职要提前 ${input.noticeDays} 天通知，超过了法定的 30 天`,
      basis,
      steps: [
        `约定：提前 ${input.noticeDays} 天`,
        "第三十七条：劳动者提前三十日以书面形式通知用人单位，可以解除劳动合同",
      ],
    });
  if (input.probationNoticeDays != null && input.probationNoticeDays > 3)
    out.push({
      rule: "R16",
      verdict: "violation",
      title: `试用期辞职要提前 ${input.probationNoticeDays} 天，法定只要 3 天`,
      basis,
      steps: [
        `约定：试用期内提前 ${input.probationNoticeDays} 天`,
        "第三十七条：试用期内提前三日通知即可",
      ],
    });
  if (input.needsApproval)
    out.push({
      rule: "R16",
      verdict: "violation",
      title: "辞职不需要单位批准",
      basis,
      steps: ["约定：辞职要经单位批准或同意", "第三十七条：提前通知后就可以解除，不需要对方同意"],
    });
  if (input.penaltyOrDeduction)
    out.push({
      rule: "R16",
      verdict: "violation",
      title: "因为辞职扣工资或要求赔钱，这一条无效",
      basis: [...basis, "ldhtf-25-1"],
      steps: [
        "约定：辞职或未经批准离开要扣发报酬、支付违约金",
        "这同时属于第二十五条不允许约定的违约金",
      ],
    });
  // 检查过辞职条款且没有问题，给一条 ok，报告汇总里计数
  if (out.length === 0 && (input.noticeDays != null || input.probationNoticeDays != null))
    out.push({
      rule: "R16",
      verdict: "ok",
      title: "辞职条款和第三十七条一致",
      basis,
      steps: [`约定：提前 ${input.noticeDays ?? input.probationNoticeDays} 天通知`],
    });
  return out;
}
