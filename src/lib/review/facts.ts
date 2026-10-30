// 抽取步骤的输出结构（项目方案第 4 节第 2 步）。字段和 MCP 规则工具的参数一一对应，
// 计划步骤（plan.ts）直接把这些字段转成工具调用，不再经过模型。
//
// 每一项都带 src（条款编号 + 原文片段）：报告里批注要能点回合同原文，自检要核对片段确实在合同里。
// 字段都写成"可为空"而不是"可省略"：平台的 json_schema 模式下，可省略的字段模型时有时无，
// 可为空的字段模型每次都会写出来，缺的就是 null，计划步骤好判断。
// .describe() 里的话会随 JSON Schema 一起发给模型，是逐字段的抽取说明。

import { z } from "zod";
import { containsQuote, sameSpot } from "./text.ts";

export const DOC_KINDS = ["劳动合同", "三方协议", "录用通知", "实习协议", "其他"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const src = z
  .object({
    clause: z
      .string()
      .nullable()
      .describe("条款编号，照合同写法抄，如“第三条”“三”；没有编号填 null"),
    quote: z
      .string()
      .describe("支撑这一项的合同原文，从合同里一字不改地连续摘一段，10~80 字，不要拼接两处"),
  })
  .describe("出处");
export type Src = z.infer<typeof src>;

const PENALTY_TRIGGERS = [
  "early_resign",
  "probation_resign",
  "notice",
  "confidentiality",
  "rules_violation",
  "breach_tripartite",
  "other",
] as const;

export const FactsSchema = z.object({
  docKind: z.enum(DOC_KINDS).describe("文书类型"),
  workPlace: z
    .object({
      province: z.string().nullable().describe("省级行政区，如“浙江”“上海”，不带“省”“市”"),
      city: z.string().nullable().describe("城市，如“杭州”“上海”，不带“市”"),
      src,
    })
    .nullable()
    .describe("工作地点；没写工作地点就按用人单位所在地"),
  term: z
    .object({
      kind: z
        .enum(["fixed", "open", "task"])
        .describe("fixed 固定期限，open 无固定期限，task 以完成一定工作任务为期限"),
      start: z.string().nullable().describe("起始日期 YYYY-MM-DD"),
      end: z.string().nullable().describe("终止日期 YYYY-MM-DD"),
      months: z.number().nullable().describe("只写了“3 年”“6 个月”这类时长、没写起止日期时填月数"),
      src,
    })
    .nullable()
    .describe("劳动合同期限。三方协议、录用通知里写了将来劳动合同的期限也填"),
  probation: z
    .object({
      months: z.number().nullable().describe("试用期月数"),
      days: z.number().nullable().describe("试用期写成天数时填天数，months 填 null"),
      src,
    })
    .nullable()
    .describe("约定的试用期"),
  probationOnly: z
    .object({ src })
    .nullable()
    .describe("先签试用期合同、试用期满再签正式劳动合同这类只约定试用期的写法；没有填 null"),
  wage: z
    .object({
      probation: z.number().nullable().describe("试用期月工资，元"),
      regular: z.number().nullable().describe("转正后（或约定的）月工资，元"),
      src,
    })
    .nullable()
    .describe("月工资。实习补贴也填在 regular"),
  penalties: z
    .array(
      z.object({
        party: z
          .enum(["worker", "employer"])
          .describe("谁付：worker 劳动者或学生，employer 用人单位"),
        trigger: z
          .enum(PENALTY_TRIGGERS)
          .describe(
            "触发条件：early_resign 提前离职或辞职（含扣发工资、补贴），probation_resign 试用期离职，notice 未提前通知，confidentiality 违反保密，rules_violation 违反规章制度，breach_tripartite 三方协议里不报到、拒签劳动合同、拒绝接收，other 其他",
          ),
        amount: z.number().nullable().describe("金额，元；扣发工资之类没有固定金额的填 null"),
        src,
      }),
    )
    .describe(
      "违约金和因离职扣钱的约定。服务期、竞业限制、户口住房换服务期的违约金不写在这里，写在各自的字段；押金、保证金不是违约金，写进 deposits",
    ),
  servicePeriod: z
    .object({
      trainingKind: z
        .enum(["special", "onboarding", "unknown"])
        .describe("special 单位出钱的专业技术培训，onboarding 入职培训、岗前培训，unknown 看不出"),
      trainingCost: z.number().nullable().describe("培训费，元"),
      serviceMonths: z.number().nullable().describe("服务期月数"),
      penalty: z
        .object({
          kind: z
            .enum(["full_cost", "prorated", "amount"])
            .describe(
              "full_cost 离职返还全部培训费，prorated 按未履行月数折算，amount 写了固定金额",
            ),
          amount: z.number().nullable(),
        })
        .describe("违反服务期要付什么"),
      src,
    })
    .nullable()
    .describe("因培训约定的服务期"),
  specialBenefit: z
    .object({
      benefit: z
        .enum(["hukou", "housing", "other"])
        .describe("hukou 落户，housing 住房，other 其他特殊待遇"),
      serviceYears: z.number().nullable(),
      amount: z.number().nullable().describe("未满服务期要付的违约金，元"),
      src,
    })
    .nullable()
    .describe("用落户、住房等特殊待遇换服务期的约定"),
  nonCompete: z
    .object({
      durationMonths: z.number().nullable().describe("离职后限制的月数"),
      compensation: z
        .enum(["none", "agreed", "unknown"])
        .describe(
          "离职后有没有约定按月给经济补偿：none 没有约定（合同里没写补偿就是 none），agreed 写了补偿，unknown 看不出",
        ),
      role: z.string().nullable().describe("劳动者的岗位"),
      roleLevel: z
        .enum(["senior", "ordinary", "unknown"])
        .describe(
          "senior 高管、高级技术人员或明确负有保密义务；ordinary 应届生、普通岗位；看不出填 unknown",
        ),
      duringEmploymentOnly: z.boolean().describe("只限制在职期间、不涉及离职后的填 true"),
      src,
    })
    .nullable()
    .describe("竞业限制：离职后不得到同行业、有竞争关系的单位任职或自己经营"),
  deposits: z
    .array(
      z.object({
        kind: z
          .enum([
            "deposit",
            "guarantee",
            "keep_original_certificate",
            "prepay_fee",
            "verify_original",
          ])
          .describe(
            "deposit 押金、保证金，guarantee 要求担保，keep_original_certificate 身份证、毕业证、学位证等证件原件交给单位保管或扣留（不论保管多久），prepay_fee 预交培训费、服装费等费用，verify_original 只核验原件、当场归还",
          ),
        amount: z.number().nullable(),
        src,
      }),
    )
    .describe("押金、担保、单位保管或扣留证件原件、预交费用，每处一项"),
  requiredClauses: z
    .object({
      employer: z.boolean().describe("用人单位名称、住所、法定代表人"),
      employee: z.boolean().describe("劳动者姓名、住址、身份证号（打码了也算有）"),
      term: z.boolean().describe("合同期限"),
      job: z.boolean().describe("工作内容和工作地点"),
      hours: z.boolean().describe("工作时间和休息休假"),
      pay: z.boolean().describe("劳动报酬"),
      social_insurance: z.boolean().describe("社会保险"),
      protection: z.boolean().describe("劳动保护、劳动条件和职业危害防护"),
    })
    .nullable()
    .describe("劳动合同第十七条的必备条款各有没有写；不是劳动合同填 null"),
  socialInsurance: z
    .object({
      waived: z.boolean().describe("约定不缴社保、自愿放弃社保、以补贴代替社保的填 true"),
      subsidy: z.number().nullable().describe("代替社保的每月补贴，元"),
      src,
    })
    .nullable()
    .describe("只在约定不缴或以补贴代替社保时填；正常写了缴社保的填 null"),
  unilateralChange: z
    .object({
      changes: z.array(z.enum(["position", "location", "wage"])).describe("单位可以单方调整的内容"),
      wageCut: z.boolean().describe("写明可以降薪"),
      refuseMeansResign: z.boolean().describe("不服从调整视为自动离职或按旷工处理"),
      src,
    })
    .nullable()
    .describe("单位可以单方调岗、调地点、调薪的约定"),
  termination: z
    .array(
      z.object({
        kind: z
          .enum(["probation_at_will", "other"])
          .describe(
            "probation_at_will 试用期内单位可随时或无理由解除，other 其他法定情形以外的解除或终止条件",
          ),
        src,
      }),
    )
    .describe(
      "用人单位一方可以解除合同、或者合同自动终止的条件，只写法律规定以外的；写“按劳动合同法执行”的不填。劳动者辞职的约定写进 resignation，不写在这里",
    ),
  resignation: z
    .object({
      noticeDays: z.number().nullable().describe("辞职要提前几天通知；写“一个月”按 30 填"),
      probationNoticeDays: z.number().nullable().describe("试用期辞职要提前几天"),
      needsApproval: z.boolean().describe("辞职要单位批准、同意"),
      penaltyOrDeduction: z.boolean().describe("辞职或未经批准离开要扣钱、付违约金"),
      src,
    })
    .nullable()
    .describe("劳动者辞职的约定"),
  standardTerms: z
    .array(z.object({ src }))
    .describe(
      "三方协议、录用通知里单位预先拟定、免除单位责任或加重学生责任的条款，如“最终解释权归甲方所有”；其他文书填空数组",
    ),
  others: z
    .array(
      z.object({
        concern: z.string().describe("这一条可能有什么问题，一句话"),
        src,
      }),
    )
    .describe(
      "上面各字段都管不到、但看起来可能损害劳动者权益的条款，最多 5 条，如加班不付加班费、扣工资、年假作废、产假过短。能放进上面某个字段的（押金、扣证件、违约金、试用期、辞职等）放进那个字段，不要放在这里；写对的条款不要列",
    ),
});

export type Facts = z.infer<typeof FactsSchema>;

// 检查记录里显示的字段名
export const FIELD_LABEL: Record<string, string> = {
  workPlace: "工作地点",
  term: "合同期限",
  probation: "试用期",
  probationOnly: "只约定试用期",
  wage: "工资",
  penalties: "违约金",
  servicePeriod: "服务期",
  specialBenefit: "特殊待遇换服务期",
  nonCompete: "竞业限制",
  deposits: "押金和证件",
  socialInsurance: "社保",
  unilateralChange: "单方调整",
  termination: "解除条件",
  resignation: "辞职",
  standardTerms: "格式条款",
  others: "其他条款",
};

// ── 抽取结果的程序检查 ──────────────────────────────────

type Dropped = { field: string; quote: string };

/**
 * 去掉出处对不上的字段：quote 是空的、或者在合同里找不到。没有出处的字段不拿去算结论。
 * 不开思考时模型会把可为空的字段也填上内容（10-30：录用通知里编出"住房换服务期"，
 * 实习协议里竞业限制的 quote 是空字符串），这些字段进了规则就成了凭空的批注。
 */
export function dropUnsourced(f: Facts, text: string): { facts: Facts; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const ok = (field: string, x: { src: Src }) => {
    if (containsQuote(text, x.src.quote)) return true;
    dropped.push({ field, quote: x.src.quote });
    return false;
  };
  const one = <T extends { src: Src } | null>(field: string, x: T): T | null =>
    x && ok(field, x) ? x : null;
  const many = <T extends { src: Src }>(field: string, xs: T[]) => xs.filter((x) => ok(field, x));
  return {
    facts: {
      ...f,
      workPlace: one("workPlace", f.workPlace),
      term: one("term", f.term),
      probation: one("probation", f.probation),
      probationOnly: one("probationOnly", f.probationOnly),
      wage: one("wage", f.wage),
      penalties: many("penalties", f.penalties),
      servicePeriod: one("servicePeriod", f.servicePeriod),
      specialBenefit: one("specialBenefit", f.specialBenefit),
      nonCompete: one("nonCompete", f.nonCompete),
      deposits: many("deposits", f.deposits),
      socialInsurance: one("socialInsurance", f.socialInsurance),
      unilateralChange: one("unilateralChange", f.unilateralChange),
      termination: many("termination", f.termination),
      resignation: one("resignation", f.resignation),
      standardTerms: many("standardTerms", f.standardTerms),
      others: many("others", f.others),
    },
    dropped,
  };
}

// ── 给自检看的字段说明 ──────────────────────────────────

type JsonNode = {
  description?: string;
  properties?: Record<string, JsonNode>;
  items?: JsonNode;
  anyOf?: JsonNode[];
};

// 计划步骤里 evidence 用的名字 → 抽取结构里的字段名
const EVIDENCE_FIELD: Record<string, string> = {
  penalty: "penalties",
  deposit: "deposits",
  standardTerm: "standardTerms",
};

let schemaCache: Record<string, JsonNode> | null = null;

/**
 * 字段的含义，取自上面 .describe() 的说明（和抽取时模型看到的是同一份）。
 * 自检时附上：10-30 不附说明时，自检模型把 compensation: "none"（没有约定补偿）当成"原文没写、属于推断"。
 */
export function fieldGuide(evidenceField: string): string {
  schemaCache ??= (z.toJSONSchema(FactsSchema) as { properties: Record<string, JsonNode> })
    .properties;
  const outer: JsonNode | undefined = schemaCache[EVIDENCE_FIELD[evidenceField] ?? evidenceField];
  if (!outer) return "";
  // 可为空的字段在 JSON Schema 里是 anyOf [对象, null]，说明挂在外层
  const node = outer.anyOf?.find((x) => x.properties || x.items) ?? outer;
  const head = outer.description ?? node.description ?? "";
  const props = node.items?.properties ?? node.properties ?? {};
  const parts = Object.entries(props)
    .filter(([k]) => k !== "src")
    .map(([k, v]) => {
      const d = (v.anyOf?.find((x) => x.description) ?? v).description;
      return d ? `${k}：${d}` : "";
    })
    .filter(Boolean);
  return [head, ...parts].filter(Boolean).join("；");
}

/**
 * 去掉重复归类的条目。不开思考的抽取常把同一段话放进两个字段（10-30 四份样例）：
 * 违约金、竞业限制条款同时出现在 others 里，模型又判断一遍，同一处出两条批注；
 * 劳动者辞职的条款同时放进 termination，规则 R15 把它当成单位的解除条件。
 * 规则字段优先：others 和任何规则字段说的是同一处就去掉；termination 和 resignation 是同一处就去掉。
 */
export function reconcile(f: Facts): { facts: Facts; merged: Dropped[] } {
  const merged: Dropped[] = [];
  const ruleQuotes = [
    f.term,
    f.probation,
    f.probationOnly,
    f.wage,
    f.servicePeriod,
    f.specialBenefit,
    f.nonCompete,
    f.socialInsurance,
    f.unilateralChange,
    f.resignation,
    ...f.penalties,
    ...f.deposits,
    ...f.termination,
    ...f.standardTerms,
  ].flatMap((x) => (x ? [x.src.quote] : []));
  const others = f.others.filter((o) => {
    const dup = ruleQuotes.some((q) => sameSpot(q, o.src.quote));
    if (dup) merged.push({ field: "others", quote: o.src.quote });
    return !dup;
  });
  const termination = f.termination.filter((t) => {
    const dup = f.resignation !== null && sameSpot(f.resignation.src.quote, t.src.quote);
    if (dup) merged.push({ field: "termination", quote: t.src.quote });
    return !dup;
  });
  return { facts: { ...f, others, termination }, merged };
}
