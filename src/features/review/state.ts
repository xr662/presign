// 检查页的状态：把审查流程推来的事件（src/lib/review/events.ts）归并成界面要显示的东西。
// 纯函数。实时检查、回放示例、端到端测试都用同一个 reducer，回放录好的事件就能复现一次检查。

import type { ReviewEvent, ReviewFinding, Revision, Verdict } from "@/lib/review/events";
import type { LogEntry } from "./components/check-log";
import { SEVERITY_ORDER } from "./verdict";

export type FindingView = ReviewFinding & {
  /** 自检没通过的原因（等级已改成需要确认） */
  verifyNote: string | null;
  report: { conclusion: string; revision: Revision | null; talkingPoint: string | null } | null;
};

// args：工具调用的输入，结果回来时和输出一起放进"输入与输出"
export type LogRow = LogEntry & { key: string; args?: unknown };

export type ReviewState = {
  status: "idle" | "running" | "done" | "error";
  docKind: string | null;
  log: LogRow[];
  findings: FindingView[];
  summary: string | null;
  counts: Record<Verdict, number> | null;
  error: { code: string; message: string } | null;
  modelCalls: number;
};

export const initialReview: ReviewState = {
  status: "idle",
  docKind: null,
  log: [],
  findings: [],
  summary: null,
  counts: null,
  error: null,
  modelCalls: 0,
};

export type ReviewAction = { type: "reset" } | { type: "start" } | ReviewEvent;

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// 截断，免得一条记录撑满屏幕
const clip = (s: string, n = 1200) => (s.length > n ? `${s.slice(0, n)}…` : s);

function toolText(tool: string, label: string) {
  return tool === "search_law" ? label : `调用 ${tool}：${label}`;
}

export function reduceReview(s: ReviewState, e: ReviewAction): ReviewState {
  switch (e.type) {
    case "reset":
      return initialReview;
    case "start":
      return { ...initialReview, status: "running" };
    case "step": {
      // 同一步的"进行中"在完成时原地改写；其余（补充说明）另起一行
      const key = `step:${e.step}`;
      const entry: LogRow = { key, at: sec(e.at), text: e.text, state: e.state };
      const i = s.log.findIndex((x) => x.key === key && x.state === "running");
      if (i >= 0 && e.state !== "running") return { ...s, log: s.log.with(i, entry) };
      return { ...s, log: [...s.log, entry] };
    }
    case "plan":
      return { ...s, docKind: e.docKind };
    case "tool_call":
      return {
        ...s,
        log: [
          ...s.log,
          {
            key: `tool:${e.id}`,
            at: sec(e.at),
            text: toolText(e.tool, e.label),
            state: "running",
            args: e.args,
          },
        ],
      };
    case "tool_result":
      return {
        ...s,
        log: s.log.map((x) =>
          x.key === `tool:${e.id}`
            ? {
                ...x,
                state: e.ok ? "done" : "failed",
                detail: clip(
                  `输入 ${JSON.stringify(x.args)}\n输出 ${JSON.stringify(e.result)}\n耗时 ${e.ms}ms`,
                ),
              }
            : x,
        ),
      };
    case "finding":
      return { ...s, findings: [...s.findings, { ...e.finding, verifyNote: null, report: null }] };
    case "verify":
      return {
        ...s,
        findings: s.findings.map((f) =>
          f.id === e.findingId ? { ...f, verdict: e.verdict, verifyNote: e.reason } : f,
        ),
      };
    case "report":
      return {
        ...s,
        findings: s.findings.map((f) =>
          f.id === e.findingId
            ? {
                ...f,
                report: {
                  conclusion: e.conclusion,
                  revision: e.revision,
                  talkingPoint: e.talkingPoint,
                },
              }
            : f,
        ),
      };
    case "done":
      return {
        ...s,
        status: s.error ? "error" : "done",
        summary: e.summary,
        counts: e.counts,
        modelCalls: e.modelCalls,
        // 中途停下时还在"进行中"的行改掉，不留一条永远在转的记录
        log: s.log.map((x) =>
          x.state === "running" ? { ...x, state: s.error ? "failed" : "done" } : x,
        ),
      };
    case "error":
      return {
        ...s,
        status: "error",
        error: { code: e.code, message: e.message },
        log: [...s.log, { key: `error:${e.at}`, at: sec(e.at), text: e.message, state: "failed" }],
      };
  }
}

/** 批注按严重程度排，同等级按出现顺序；ok 不出卡片，只在汇总里计数 */
export function visibleFindings(s: ReviewState): FindingView[] {
  return s.findings
    .map((f, i) => ({ f, i }))
    .filter((x) => x.f.verdict !== "ok")
    .sort((a, b) => SEVERITY_ORDER[b.f.verdict] - SEVERITY_ORDER[a.f.verdict] || a.i - b.i)
    .map((x) => x.f);
}
