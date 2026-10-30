// 四份示例合同（data/samples/）的抽取结果，人工按原文填写，和 mcp/labor-law/rules/rules.test.ts
// 末尾那组字段一致。用途：测计划步骤和规则工具的衔接（plan.test.ts），以及在不调模型时跑通整个审查流程。
// quote 都是原文里连续的一段，测试会逐条核对。

import type { Facts } from "./facts.ts";

const none = {
  workPlace: null,
  term: null,
  probation: null,
  probationOnly: null,
  wage: null,
  penalties: [],
  servicePeriod: null,
  specialBenefit: null,
  nonCompete: null,
  deposits: [],
  requiredClauses: null,
  socialInsurance: null,
  unilateralChange: null,
  termination: [],
  resignation: null,
  standardTerms: [],
  others: [],
} satisfies Omit<Facts, "docKind">;

export const SAMPLE_FACTS: Record<string, Facts> = {
  labor: {
    ...none,
    docKind: "劳动合同",
    workPlace: {
      province: "浙江",
      city: "杭州",
      src: { clause: "第一条", quote: "工作地点为浙江省杭州市" },
    },
    term: {
      kind: "fixed",
      start: "2027-07-01",
      end: "2029-06-30",
      months: null,
      src: { clause: "第三条", quote: "劳动合同期限自 2027 年 7 月 1 日起至 2029 年 6 月 30 日止" },
    },
    probation: { months: 3, days: null, src: { clause: "第三条", quote: "其中试用期 3 个月" } },
    wage: {
      probation: 8000,
      regular: 10000,
      src: { clause: "第五条", quote: "乙方试用期月工资 8000 元，转正后月工资 10000 元" },
    },
    penalties: [
      {
        party: "worker",
        trigger: "early_resign",
        amount: 20000,
        src: {
          clause: "第七条",
          quote: "乙方在合同期内提前离职的，应向甲方支付违约金人民币 20000 元",
        },
      },
    ],
    servicePeriod: {
      trainingKind: "special",
      trainingCost: 6000,
      serviceMonths: 24,
      penalty: { kind: "prorated", amount: null },
      src: { clause: "第八条", quote: "按服务期尚未履行的月数折算返还培训费用" },
    },
    nonCompete: {
      durationMonths: 36,
      compensation: "none",
      role: "软件开发工程师",
      roleLevel: "unknown",
      duringEmploymentOnly: false,
      src: { clause: "第九条", quote: "离职后 3 年内不得到同行业公司任职" },
    },
    requiredClauses: {
      employer: true,
      employee: true,
      term: true,
      job: true,
      hours: true,
      pay: true,
      social_insurance: true,
      protection: true,
    },
    resignation: {
      noticeDays: 30,
      probationNoticeDays: null,
      needsApproval: false,
      penaltyOrDeduction: false,
      src: { clause: "第十一条", quote: "乙方提前三十日以书面形式通知甲方，可以解除本合同" },
    },
  },
  tripartite: {
    ...none,
    docKind: "三方协议",
    workPlace: {
      province: "江苏",
      city: "苏州",
      src: { clause: null, quote: "单位所在地：江苏省苏州市工业园区示例路 6 号" },
    },
    term: {
      kind: "fixed",
      start: null,
      end: null,
      months: 36,
      src: { clause: "三", quote: "劳动合同期限 3 年" },
    },
    probation: { months: 6, days: null, src: { clause: "三", quote: "其中试用期 6 个月" } },
    wage: {
      probation: 6000,
      regular: 9000,
      src: { clause: "三", quote: "试用期月工资 6000 元，转正后月工资 9000 元" },
    },
    penalties: [
      {
        party: "worker",
        trigger: "breach_tripartite",
        amount: 10000,
        src: {
          clause: "五",
          quote: "乙方不按时报到或报到后拒签劳动合同的，向甲方支付违约金 10000 元",
        },
      },
      {
        party: "employer",
        trigger: "breach_tripartite",
        amount: 3000,
        src: { clause: "五", quote: "甲方无故拒绝接收乙方的，向乙方支付违约金 3000 元" },
      },
    ],
    specialBenefit: {
      benefit: "hukou",
      serviceYears: 5,
      amount: 50000,
      src: {
        clause: "四",
        quote: "乙方须在甲方服务满 5 年，未满 5 年离职的，向甲方支付违约金 50000 元",
      },
    },
    standardTerms: [{ src: { clause: "六", quote: "最终解释权归甲方所有" } }],
  },
  offer: {
    ...none,
    docKind: "录用通知",
    workPlace: { province: "上海", city: "上海", src: { clause: "二", quote: "工作地点：上海市" } },
    probation: {
      months: 6,
      days: null,
      src: { clause: "四", quote: "入职后先签订 6 个月试用期合同" },
    },
    probationOnly: {
      src: {
        clause: "四",
        quote: "入职后先签订 6 个月试用期合同，试用期满考核合格后再签订正式劳动合同",
      },
    },
    wage: {
      probation: 2600,
      regular: 6000,
      src: { clause: "三", quote: "试用期月工资 2600 元，转正后月工资 6000 元" },
    },
    deposits: [
      {
        kind: "keep_original_certificate",
        amount: null,
        src: { clause: "五", quote: "毕业证、学位证原件交人事部统一保管至试用期结束" },
      },
    ],
  },
  internship: {
    ...none,
    docKind: "实习协议",
    workPlace: {
      province: "广东",
      city: "广州",
      src: { clause: null, quote: "地址：广东省广州市天河区示例路 3 号" },
    },
    term: {
      kind: "fixed",
      start: "2027-03-01",
      end: "2027-06-30",
      months: null,
      src: { clause: "一", quote: "实习期限：2027 年 3 月 1 日至 2027 年 6 月 30 日" },
    },
    wage: {
      probation: null,
      regular: 3000,
      src: { clause: "三", quote: "实习补贴为每月 3000 元" },
    },
    penalties: [
      {
        party: "worker",
        trigger: "early_resign",
        amount: null,
        src: { clause: "五", quote: "未经批准擅自离开的，扣发当月实习补贴" },
      },
    ],
    deposits: [
      {
        kind: "deposit",
        amount: 500,
        src: { clause: "四", quote: "乙方入职时须缴纳工服押金 500 元" },
      },
    ],
    unilateralChange: {
      changes: ["position", "location"],
      wageCut: false,
      refuseMeansResign: true,
      src: {
        clause: "二",
        quote:
          "甲方可根据经营需要调整乙方的实习岗位和实习地点，乙方应当服从；不服从安排的，视为自动离职",
      },
    },
    resignation: {
      noticeDays: 30,
      probationNoticeDays: null,
      needsApproval: true,
      penaltyOrDeduction: true,
      src: { clause: "五", quote: "须提前一个月书面申请，经甲方批准后方可离开" },
    },
  },
};
