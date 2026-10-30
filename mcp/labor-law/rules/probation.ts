// R01 试用期超过法定上限、R02 不得约定试用期却约定了、R03 只约定了试用期（劳动合同法第十九条）。
// 规则清单里一条规则一个文件；这里按 MCP 工具分组（check_probation 一次跑这三条），每条仍是独立函数。

import { addMonths, parseDate, prevDay, reachesMonths } from "./dates.ts";
import type { Finding } from "./types.ts";

export type Term =
  | { kind: "fixed"; start: string; end: string }
  | { kind: "fixed"; months: number }
  | { kind: "open" } // 无固定期限
  | { kind: "task" }; // 以完成一定工作任务为期限
export type Probation = { months: number } | { days: number };

type Band = { limit: number; desc: string } | { limit: 0; desc: string; forbidden: true };

/** 合同期限落在哪一档、试用期上限几个月 */
export function band(term: Term): Band {
  if (term.kind === "task") return { limit: 0, desc: "以完成一定工作任务为期限", forbidden: true };
  if (term.kind === "open") return { limit: 6, desc: "无固定期限" };
  const reach = (n: number) =>
    "months" in term ? term.months >= n : reachesMonths(term.start, term.end, n);
  const span = "months" in term ? `${term.months} 个月` : `${term.start} 至 ${term.end}`;
  if (reach(36)) return { limit: 6, desc: `${span}，满 3 年` };
  if (reach(12)) return { limit: 2, desc: `${span}，满 1 年不满 3 年` };
  if (reach(3)) return { limit: 1, desc: `${span}，满 3 个月不满 1 年` };
  return { limit: 0, desc: `${span}，不满 3 个月`, forbidden: true };
}

const pText = (p: Probation) => ("months" in p ? `${p.months} 个月` : `${p.days} 天`);

/** 试用期是否超过上限。写成天数又不知道起算日时，可能没法下结论 */
function exceeds(p: Probation, limit: number, start?: string): boolean | "unclear" {
  if ("months" in p) return p.months > limit;
  if (start) {
    // 试用期最后一天 = 起算日 + 天数 − 1；上限最后一天 = 起算日 + limit 个月 − 1 天
    return parseDate(start) + (p.days - 1) * 86400_000 > addMonths(start, limit) - 86400_000;
  }
  if (p.days > limit * 31) return true;
  if (p.days <= limit * 28) return false;
  return "unclear";
}

export function checkProbationLimit(term: Term, probation: Probation | null): Finding | null {
  if (!probation) return null;
  const b = band(term);
  if ("forbidden" in b) return checkProbationForbidden(term, probation);
  const start = term.kind === "fixed" && "start" in term ? term.start : undefined;
  const over = exceeds(probation, b.limit, start);
  const base = { rule: "R01", basis: ["ldhtf-19-1", "ldhtf-83"] };
  const steps = [
    `合同期限：${b.desc}`,
    `这一档的试用期上限：${b.limit} 个月`,
    `合同约定：${pText(probation)}`,
  ];
  if (over === "unclear")
    return {
      ...base,
      verdict: "needs_review",
      title: `试用期 ${pText(probation)}，接近 ${b.limit} 个月的上限，要看起算日`,
      steps,
      factsNeeded: ["试用期从哪一天开始算"],
    };
  if (!over)
    return { ...base, verdict: "ok", title: `试用期没有超过 ${b.limit} 个月的上限`, steps };
  if ("months" in probation) steps.push(`超出 ${probation.months - b.limit} 个月`);
  else if (start) steps.push(`上限算到 ${prevDay(addMonths(start, b.limit))}`);
  return {
    ...base,
    verdict: "violation",
    title: `合同${b.desc.replace(/^.*，/, "")}，试用期最长 ${b.limit} 个月，这里写了 ${pText(probation)}`,
    steps,
    note: "违法约定的试用期已经履行的，用人单位要以试用期满月工资为标准，按超出的期间支付赔偿金（第八十三条）。",
  };
}

export function checkProbationForbidden(term: Term, probation: Probation | null): Finding | null {
  if (!probation) return null;
  const b = band(term);
  if (!("forbidden" in b)) return null;
  return {
    rule: "R02",
    verdict: "violation",
    title: `${b.desc}的合同不能约定试用期`,
    basis: ["ldhtf-19-3"],
    steps: [
      `合同期限：${b.desc}`,
      `约定了试用期 ${pText(probation)}`,
      "第十九条第三款：这类合同不得约定试用期",
    ],
  };
}

/** R03：只约定了试用期，或者合同期限就是试用期 */
export function checkProbationOnly(input: {
  probationOnly: boolean;
  term?: Term | null;
  probation?: Probation | null;
}): Finding | null {
  const sameAsTerm =
    input.term?.kind === "fixed" &&
    "months" in input.term &&
    input.probation &&
    "months" in input.probation &&
    input.term.months === input.probation.months;
  if (!input.probationOnly && !sameAsTerm) return null;
  return {
    rule: "R03",
    verdict: "violation",
    title: "只约定了试用期，试用期不成立，这段期限就是劳动合同期限",
    basis: ["ldhtf-19-4"],
    steps: [
      input.probationOnly
        ? "文书写的是先签试用期合同，没有单独的劳动合同期限"
        : "合同期限和试用期一样长",
      "第十九条第四款：劳动合同仅约定试用期的，试用期不成立，该期限为劳动合同期限",
    ],
    note: "这段时间你享有正式员工的全部权利，用人单位不能按试用期的条件随意解除。",
  };
}
