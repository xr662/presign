// 四份示例合同（虚构）。正文在 data/samples/，标准答案在 answers.json；
// 检查过程是用真实模型跑一遍录下的事件（public/recordings/，由 node scripts/eval/review.ts --record 生成），
// 示例页回放这份录像，不调用模型，评审不用登录也能看。
export const SAMPLES = [
  { id: "labor", title: "劳动合同", note: "两年期，试用期、违约金、竞业限制条款有问题" },
  {
    id: "tripartite",
    title: "三方协议",
    note: "用落户换五年服务期违约金、试用期工资偏低、“最终解释权归甲方所有”",
  },
  {
    id: "offer",
    title: "录用通知",
    note: "先签试用期合同再签正式合同、扣毕业证、试用期工资低于上海最低工资",
  },
  {
    id: "internship",
    title: "实习协议",
    note: "工服押金、提前结束实习要批准、不服从调岗视为自动离职",
  },
] as const;

export type SampleId = (typeof SAMPLES)[number]["id"];
