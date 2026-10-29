import type { Annotation } from "./components/annotation-card";
import type { LogEntry } from "./components/check-log";

// 首页示例报告用的静态数据（虚构合同）。T19 换成示例合同的真实检查结果。
// 法条原文与官方文本逐字核对过（规划文档《规则清单》第 1 节的来源）。

export const DEMO_CLAUSES = [
  {
    no: "3",
    text: "劳动合同期限自 2027 年 7 月 1 日起至 2029 年 6 月 30 日止，其中试用期 3 个月。",
  },
  { no: "5", text: "乙方试用期月工资 8000 元，转正后月工资 10000 元。" },
  { no: "7", text: "乙方在合同期内提前离职的，应向甲方支付违约金人民币 20000 元。" },
  {
    no: "9",
    text: "乙方须对甲方经营信息保密，离职后 3 年内不得到同行业公司任职。",
  },
] as const;

export const DEMO_ANNOTATIONS: Annotation[] = [
  {
    clauseNo: "3",
    verdict: "violation",
    conclusion: "合同满 2 年，试用期最长 2 个月。这里写了 3 个月，多了 1 个月。",
    basis: [
      {
        id: "ldhtf-19-1",
        label: "劳动合同法第十九条第一款",
        text: "劳动合同期限三个月以上不满一年的，试用期不得超过一个月；劳动合同期限一年以上不满三年的，试用期不得超过二个月；三年以上固定期限和无固定期限的劳动合同，试用期不得超过六个月。",
      },
    ],
    steps: [
      "合同期限：2027-07-01 至 2029-06-30，满 2 年",
      "满 1 年不满 3 年，试用期上限 2 个月",
      "合同写的是 3 个月，超出 1 个月",
    ],
    revision: { before: "其中试用期 3 个月。", after: "其中试用期 2 个月。" },
  },
  {
    clauseNo: "7",
    verdict: "violation",
    conclusion: "这条违约金约定无效。劳动合同里只有服务期和竞业限制两种情形可以约定由你付违约金。",
    basis: [
      {
        id: "ldhtf-25",
        label: "劳动合同法第二十五条",
        text: "除本法第二十二条和第二十三条规定的情形外，用人单位不得与劳动者约定由劳动者承担违约金。",
      },
    ],
    steps: [
      "违约金的触发条件：提前离职",
      "不属于服务期（第二十二条）或竞业限制（第二十三条）",
      "按第二十五条，这条约定无效",
    ],
    revision: {
      before: "乙方在合同期内提前离职的，应向甲方支付违约金人民币 20000 元。",
      after: "删除本条。",
    },
  },
  {
    clauseNo: "9",
    verdict: "violation",
    conclusion:
      "竞业限制最长 2 年，这里写了 3 年，超出的 1 年无效。条款里也没有写离职后给你的补偿。",
    basis: [
      {
        id: "ldhtf-24",
        label: "劳动合同法第二十四条",
        text: "竞业限制的人员限于用人单位的高级管理人员、高级技术人员和其他负有保密义务的人员。竞业限制的范围、地域、期限由用人单位与劳动者约定，竞业限制的约定不得违反法律、法规的规定。在解除或者终止劳动合同后，前款规定的人员到与本单位生产或者经营同类产品、从事同类业务的有竞争关系的其他用人单位，或者自己开业生产或者经营同类产品、从事同类业务的竞业限制期限，不得超过二年。",
      },
    ],
    steps: ["约定期限：离职后 3 年", "法定上限：2 年", "超出 1 年"],
    factsNeeded: ["你的岗位会不会接触公司的商业秘密。没有接触的，可以请求确认竞业限制条款不生效"],
  },
];

export const DEMO_LOG: LogEntry[] = [
  { at: "0.0s", text: "识别第 1/2 页：38 行", state: "done" },
  { at: "2.1s", text: "抽取条款：12 条，文书类型为劳动合同", state: "done" },
  { at: "2.9s", text: "列出检查计划：7 项", state: "done" },
  {
    at: "3.4s",
    text: "调用 check_probation：合同 24 个月，试用期 3 个月",
    state: "done",
    detail:
      '输入 { "term": { "kind": "fixed", "months": 24 }, "probation": { "months": 3 } }\n输出 { "verdict": "violation", "limit_months": 2, "basis": ["ldhtf-19-1"] }',
  },
  { at: "4.0s", text: "调用 check_penalty：第 7 条，触发条件为提前离职", state: "done" },
  { at: "4.8s", text: "查劳动合同法第二十四条：竞业限制期限", state: "done" },
  { at: "5.5s", text: "自检：每条批注是否都有原文出处和条文依据", state: "running" },
];
