// 审查流程推给前端的事件（项目方案第 4 节）。只有类型，没有服务端依赖，检查页可以直接 import。
// 每个事件带 at（距开始的毫秒数），检查记录按它显示时间。
//
// 和项目方案的差别：方案里的 report_delta 是逐字推送报告。这里报告按条用结构化输出生成，
// 每条批注写完推一个 report 事件；逐字推送要放弃结构化校验（改写稿必须摘自原文、数字必须出自规则），不划算。

export type Verdict =
  "violation" | "likely_violation" | "needs_review" | "advice" | "ok" | "unknown";

export type StepName = "extract" | "plan" | "execute" | "verify" | "report";

/** 依据条文。原文只来自法规库：规则结论用 get_article 取，检索结论用 search_law 返回的原文 */
export type LawRef = { id: string; label: string; text: string };

export type ReviewFinding = {
  id: string;
  /** rule：规则引擎算的；model：规则覆盖不到、模型依据检索到的条文判断的 */
  source: "rule" | "model";
  rule: string | null;
  verdict: Verdict;
  title: string;
  /** 合同原文出处；必备条款这类看全文的为 null */
  clause: string | null;
  quote: string | null;
  basis: LawRef[];
  steps: string[];
  factsNeeded: string[];
  note: string | null;
};

export type Revision = { before: string; after: string };

export type ReviewEvent =
  | { type: "step"; at: number; step: StepName; state: "running" | "done" | "failed"; text: string }
  | {
      type: "plan";
      at: number;
      docKind: string;
      checks: { id: string; tool: string; label: string; clause: string | null }[];
      others: { id: string; clause: string | null; concern: string }[];
    }
  | { type: "tool_call"; at: number; id: string; tool: string; label: string; args: unknown }
  | { type: "tool_result"; at: number; id: string; ok: boolean; ms: number; result: unknown }
  | { type: "finding"; at: number; finding: ReviewFinding }
  | {
      type: "verify";
      at: number;
      findingId: string;
      ok: boolean;
      /** 没通过时的原因；降级后的等级写在 verdict */
      reason: string | null;
      verdict: Verdict;
    }
  | {
      type: "report";
      at: number;
      findingId: string;
      conclusion: string;
      revision: Revision | null;
      talkingPoint: string | null;
    }
  | {
      type: "done";
      at: number;
      summary: string;
      counts: Record<Verdict, number>;
      modelCalls: number;
    }
  | { type: "error"; at: number; code: string; message: string };
