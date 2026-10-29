// 结论等级，和规划文档《规则清单》第 2 节一一对应。
// 规则引擎、报告、界面都只认这六个值，不在别处另造等级。
export type Verdict =
  "violation" | "likely_violation" | "needs_review" | "advice" | "ok" | "unknown";

type VerdictStyle = {
  label: string;
  // 文字色、底色、边线色都用色板变量，改色只改 globals.css
  text: string;
  bg: string;
  border: string;
  // 批注卡只在左边画一道批注色，其余三边保持细灰线；Tailwind 要写成完整类名才会生成
  borderL: string;
};

// violation 和 likely_violation 同色：对用户来说都要处理，区别写在结论文字里
export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  violation: {
    label: "违法",
    text: "text-red-pen",
    bg: "bg-red-pen-bg",
    border: "border-red-pen",
    borderL: "border-l-red-pen",
  },
  likely_violation: {
    label: "可能违法",
    text: "text-red-pen",
    bg: "bg-red-pen-bg",
    border: "border-red-pen",
    borderL: "border-l-red-pen",
  },
  needs_review: {
    label: "需要确认",
    text: "text-orange",
    bg: "bg-orange-bg",
    border: "border-orange",
    borderL: "border-l-orange",
  },
  advice: {
    label: "提示",
    text: "text-pencil",
    bg: "bg-pencil-bg",
    border: "border-pencil",
    borderL: "border-l-pencil",
  },
  ok: {
    label: "没有问题",
    text: "text-ok",
    bg: "bg-paper-2",
    border: "border-line",
    borderL: "border-l-line",
  },
  unknown: {
    label: "信息不足",
    text: "text-pencil",
    bg: "bg-pencil-bg",
    border: "border-pencil",
    borderL: "border-l-pencil",
  },
};
