// 计划步骤（项目方案第 4 节第 3 步）：把抽取出的字段转成 MCP 规则工具的调用清单。
// 纯函数，不调模型。项目方案原定这一步用模型挑规则；字段和工具参数既然一一对应，
// 哪条字段有值就调哪个工具，程序判断更稳，也省一次模型调用。
//
// 一个工具可能对应合同里的几处（几条违约金、几项押金），这里每处单独调一次：
// 规则返回的结论就能直接对应到那一处原文，批注不会挂错条款。工具调用在本机，一次几毫秒。

import type { DocKind, Facts, Src } from "./facts.ts";

export type Evidence = { field: string; value: unknown; src: Src };

export type Check = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** 检查记录里显示的一行，写实际在查什么 */
  label: string;
  /** 结论挂在哪段原文上；必备条款这类看全文的为 null */
  src: Src | null;
  /** 这次调用用到的字段和各自出处，自检时逐项核对 */
  evidence: Evidence[];
};

// 三方协议、录用通知签在劳动合同之前，违约金按民法典判断（规则 R12），不走劳动合同法第二十五条
const BEFORE_CONTRACT: DocKind[] = ["三方协议", "录用通知"];

const TERM_TEXT = { fixed: "固定期限", open: "无固定期限", task: "以完成一定工作任务为期限" };
/** 去掉出处，只留字段值（工具参数和自检材料里用） */
const strip = <T extends { src: Src }>(x: T): Omit<T, "src"> => {
  const rest: Partial<T> = { ...x };
  delete rest.src;
  return rest as Omit<T, "src">;
};

function termArg(t: NonNullable<Facts["term"]>) {
  if (t.kind !== "fixed") return { kind: t.kind };
  if (t.start && t.end) return { kind: "fixed", start: t.start, end: t.end };
  if (t.months) return { kind: "fixed", months: t.months };
  return null;
}

function termText(t: NonNullable<Facts["term"]>) {
  if (t.kind !== "fixed") return TERM_TEXT[t.kind];
  if (t.start && t.end) return `${t.start} 至 ${t.end}`;
  return t.months ? `${t.months} 个月` : "期限没写清";
}

export function planChecks(f: Facts): Check[] {
  const out: Omit<Check, "id">[] = [];
  const place = {
    city: f.workPlace?.city ?? undefined,
    province: f.workPlace?.province ?? undefined,
  };
  const placeEvidence: Evidence[] = f.workPlace
    ? [{ field: "workPlace", value: strip(f.workPlace), src: f.workPlace.src }]
    : [];

  // R01~R03 试用期
  const term = f.term ? termArg(f.term) : null;
  const p = f.probation?.days
    ? { days: f.probation.days }
    : f.probation?.months
      ? { months: f.probation.months }
      : null;
  // 只约定了试用期时试用期不成立，这段期限就是合同期限（第十九条第四款），不再按上限算一遍；
  // 不然同一段话会报出 R01 和两条 R03（10-30 录用通知样例）
  if (f.probation && term && p && !f.probationOnly) {
    out.push({
      tool: "check_probation",
      args: { term, probation: p, probationOnly: false },
      label: `试用期：合同 ${termText(f.term!)}，试用期 ${f.probation.days ? `${f.probation.days} 天` : `${f.probation.months} 个月`}`,
      src: f.probation.src,
      evidence: [
        { field: "term", value: strip(f.term!), src: f.term!.src },
        { field: "probation", value: strip(f.probation), src: f.probation.src },
      ],
    });
  }
  if (f.probationOnly)
    out.push({
      tool: "check_probation",
      args: { term: null, probation: null, probationOnly: true },
      label: "试用期：先签试用期合同、转正再签正式合同",
      src: f.probationOnly.src,
      evidence: [{ field: "probationOnly", value: true, src: f.probationOnly.src }],
    });

  // R05 试用期工资
  if (f.wage?.probation)
    out.push({
      tool: "check_probation_wage",
      args: { probationWage: f.wage.probation, agreedWage: f.wage.regular, ...place },
      label: `试用期工资：${f.wage.probation} 元，约定工资 ${f.wage.regular ?? "没写"} 元，工作地 ${place.city ?? place.province ?? "没写"}`,
      src: f.wage.src,
      evidence: [{ field: "wage", value: strip(f.wage), src: f.wage.src }, ...placeEvidence],
    });

  // R06 违约金（劳动合同、实习协议）；R12 三方协议、录用通知的违约金
  const beforeContract = BEFORE_CONTRACT.includes(f.docKind);
  if (!beforeContract)
    for (const p of f.penalties.filter((x) => x.party === "worker"))
      out.push({
        tool: "check_penalty",
        args: {
          penalties: [
            { trigger: p.trigger === "breach_tripartite" ? "other" : p.trigger, amount: p.amount },
          ],
        },
        label: `违约金：${p.src.quote.slice(0, 30)}`,
        src: p.src,
        evidence: [{ field: "penalty", value: strip(p), src: p.src }],
      });
  if (beforeContract) {
    const priced = f.penalties.filter((p) => p.amount != null);
    const mine = priced.find((p) => p.party === "worker");
    if (mine)
      out.push({
        tool: "check_tripartite",
        args: {
          penalties: priced.map((p) => ({
            party: p.party === "worker" ? "student" : "employer",
            amount: p.amount,
          })),
          monthlyWage: f.wage?.regular ?? null,
          standardTerms: [],
        },
        label: `${f.docKind}违约金：学生 ${priced
          .filter((p) => p.party === "worker")
          .map((p) => p.amount)
          .join("、")} 元，单位 ${
          priced
            .filter((p) => p.party === "employer")
            .map((p) => p.amount)
            .join("、") || "没有"
        }`,
        src: mine.src,
        evidence: priced.map((p) => ({ field: "penalty", value: strip(p), src: p.src })),
      });
    for (const t of f.standardTerms)
      out.push({
        tool: "check_tripartite",
        args: { penalties: [], standardTerms: [t.src.quote] },
        label: `格式条款：${t.src.quote.slice(0, 30)}`,
        src: t.src,
        evidence: [{ field: "standardTerm", value: t.src.quote, src: t.src }],
      });
  }

  // R07 服务期
  const sp = f.servicePeriod;
  if (sp && !(sp.penalty.kind === "amount" && sp.penalty.amount == null))
    out.push({
      tool: "check_penalty",
      args: {
        servicePeriod: {
          trainingKind: sp.trainingKind,
          trainingCost: sp.trainingCost,
          serviceMonths: sp.serviceMonths,
          servedMonths: null,
          penalty:
            sp.penalty.kind === "amount"
              ? { kind: "amount", amount: sp.penalty.amount }
              : { kind: sp.penalty.kind },
        },
      },
      label: `服务期：培训费 ${sp.trainingCost ?? "没写"} 元，服务期 ${sp.serviceMonths ?? "没写"} 个月`,
      src: sp.src,
      evidence: [{ field: "servicePeriod", value: strip(sp), src: sp.src }],
    });

  // R08 户口、住房换服务期
  if (f.specialBenefit)
    out.push({
      tool: "check_penalty",
      args: { specialBenefit: strip(f.specialBenefit) },
      label: `特殊待遇换服务期：服务 ${f.specialBenefit.serviceYears ?? "?"} 年，违约金 ${f.specialBenefit.amount ?? "没写"} 元`,
      src: f.specialBenefit.src,
      evidence: [
        { field: "specialBenefit", value: strip(f.specialBenefit), src: f.specialBenefit.src },
      ],
    });

  // R09 竞业限制
  if (f.nonCompete)
    out.push({
      tool: "check_non_compete",
      args: { present: true, ...strip(f.nonCompete) },
      label: `竞业限制：离职后 ${f.nonCompete.durationMonths ?? "?"} 个月，补偿 ${{ none: "没写", agreed: "有约定", unknown: "看不出" }[f.nonCompete.compensation]}`,
      src: f.nonCompete.src,
      evidence: [{ field: "nonCompete", value: strip(f.nonCompete), src: f.nonCompete.src }],
    });

  // R10 押金、扣证件
  for (const d of f.deposits)
    out.push({
      tool: "check_deposit",
      args: { items: [{ kind: d.kind, amount: d.amount }] },
      label: `押金、证件：${d.src.quote.slice(0, 30)}`,
      src: d.src,
      evidence: [{ field: "deposit", value: strip(d), src: d.src }],
    });

  // R11 必备条款，只查劳动合同
  if (f.docKind === "劳动合同" && f.requiredClauses)
    out.push({
      tool: "check_required_clauses",
      args: { docKind: f.docKind, present: f.requiredClauses },
      label: "必备条款：劳动合同法第十七条的九项",
      src: null,
      evidence: [],
    });

  // R13 不缴社保
  if (f.socialInsurance?.waived)
    out.push({
      tool: "check_social_insurance",
      args: { waived: true, subsidy: f.socialInsurance.subsidy },
      label: "社保：约定不缴或以补贴代替",
      src: f.socialInsurance.src,
      evidence: [
        { field: "socialInsurance", value: strip(f.socialInsurance), src: f.socialInsurance.src },
      ],
    });

  // R14~R16 单方变更、解除条件、辞职
  const uc = f.unilateralChange;
  if (uc && uc.changes.length)
    out.push({
      tool: "check_unilateral_terms",
      args: { changes: uc.changes, wageCut: uc.wageCut, refuseMeansResign: uc.refuseMeansResign },
      label: `单方调整：${uc.changes.map((c) => ({ position: "岗位", location: "地点", wage: "工资" })[c]).join("、")}`,
      src: uc.src,
      evidence: [{ field: "unilateralChange", value: strip(uc), src: uc.src }],
    });
  for (const t of f.termination)
    out.push({
      tool: "check_unilateral_terms",
      args: { termination: [{ kind: t.kind, text: t.src.quote }] },
      label: `解除条件：${t.src.quote.slice(0, 30)}`,
      src: t.src,
      evidence: [{ field: "termination", value: t.kind, src: t.src }],
    });
  if (f.resignation)
    out.push({
      tool: "check_unilateral_terms",
      args: { resignation: strip(f.resignation) },
      label: `辞职：提前 ${f.resignation.noticeDays ?? "?"} 天${f.resignation.needsApproval ? "，要单位批准" : ""}`,
      src: f.resignation.src,
      evidence: [{ field: "resignation", value: strip(f.resignation), src: f.resignation.src }],
    });

  return out.map((c, i) => ({ id: `c${i + 1}`, ...c }));
}
