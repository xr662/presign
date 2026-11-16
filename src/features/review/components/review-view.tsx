"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { findInjections } from "@/lib/review/injection";
import { cn } from "@/lib/utils";
import { locateLines } from "../locate";
import { visibleFindings, type FindingView, type ReviewState } from "../state";
import { SEVERITY_ORDER, VERDICT_STYLE, type Verdict } from "../verdict";
import { AnnotationCard, type Annotation } from "./annotation-card";
import { CheckLog } from "./check-log";
import { PaperSheet } from "./paper-sheet";

// 检查进行中和报告是同一个界面（项目方案第 2 节）：左边合同，问题条款按批注等级上色；
// 右边检查记录和批注卡，点卡片上的条款名滚到合同里那一段。手机上分"合同 / 批注"两个标签。

function clauseLabel(f: FindingView) {
  if (f.clause) return f.clause.startsWith("第") ? f.clause : `第 ${f.clause} 条`;
  return f.quote ? "这一条" : "全文";
}

export function toAnnotation(f: FindingView): Annotation {
  return {
    clauseNo: f.clause ?? f.id,
    clauseLabel: clauseLabel(f),
    verdict: f.verdict,
    conclusion: f.report?.conclusion ?? f.title,
    basis: f.basis,
    steps: f.steps,
    revision: f.report?.revision ?? undefined,
    factsNeeded: f.factsNeeded,
    talkingPoint: f.report?.talkingPoint ?? undefined,
    verifyNote: f.verifyNote ?? undefined,
    byModel: f.source === "model",
  };
}

const COUNT_LABELS: [Verdict, string][] = [
  ["violation", "违法"],
  ["likely_violation", "可能违法"],
  ["needs_review", "需要确认"],
  ["advice", "提示"],
  ["ok", "没有问题"],
];

function StatusLine({ state }: { state: ReviewState }) {
  if (state.status === "running") {
    const current = [...state.log].reverse().find((x) => x.state === "running") ?? state.log.at(-1);
    return (
      <p role="status" aria-live="polite" className="text-sm text-ink-2">
        {current ? current.text : "正在连接"}
      </p>
    );
  }
  if (state.error && state.findings.length === 0)
    return (
      <p role="alert" className="rounded-sm bg-red-pen-bg px-3 py-2 text-sm text-red-pen">
        {state.error.message}
      </p>
    );
  if (!state.counts) return null;
  return (
    <div className="space-y-2">
      {state.error && (
        <p role="alert" className="rounded-sm bg-orange-bg px-3 py-2 text-sm text-orange">
          {state.error.message}
        </p>
      )}
      <p className="text-sm font-medium">{state.summary}</p>
      <ul className="flex flex-wrap gap-2 text-xs tabular-nums">
        {COUNT_LABELS.filter(([v]) => state.counts![v] > 0).map(([v, label]) => (
          <li
            key={v}
            className={cn("rounded-sm px-1.5 py-0.5", VERDICT_STYLE[v].bg, VERDICT_STYLE[v].text)}
          >
            {label} {state.counts![v]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewView({
  lines,
  state,
  title,
  onPractice,
}: {
  lines: string[];
  state: ReviewState;
  title?: string;
  /** 检查完、有问题条款时显示"练习怎么跟 HR 谈"，由调用方存好场景再跳到练习页 */
  onPractice?: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<"contract" | "notes">("notes");
  const cards = visibleFindings(state);
  // 疑似写给 AI 的段落（项目方案第 8 节）：按行标出，检查本身照常做
  const injections = useMemo(() => findInjections(lines), [lines]);
  const injected = useMemo(() => new Set(injections.map((h) => h.index)), [injections]);

  // 每一行挂哪些批注、取最重的等级上色
  const { marks, firstLine } = useMemo(() => {
    const marks = new Map<number, { verdict: Verdict; ids: string[] }>();
    const firstLine = new Map<string, number>();
    for (const f of cards) {
      const hit = locateLines(lines, f.quote);
      if (hit.length) firstLine.set(f.id, hit[0]);
      for (const i of hit) {
        const m = marks.get(i);
        if (!m) marks.set(i, { verdict: f.verdict, ids: [f.id] });
        else {
          m.ids.push(f.id);
          if (SEVERITY_ORDER[f.verdict] > SEVERITY_ORDER[m.verdict]) m.verdict = f.verdict;
        }
      }
    }
    return { marks, firstLine };
  }, [cards, lines]);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const locate = (id: string) => {
    setActive(id);
    const i = firstLine.get(id);
    if (i === undefined) return;
    setTab("contract");
    // 手机上切到合同标签后元素才显示出来，等一帧再滚
    requestAnimationFrame(() =>
      document
        .getElementById(`line-${i}`)
        ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }),
    );
  };

  const showCard = (id: string) => {
    setActive(id);
    setTab("notes");
    requestAnimationFrame(() =>
      document
        .getElementById(`card-${id}`)
        ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" }),
    );
  };

  return (
    <div className="space-y-4">
      <StatusLine state={state} />
      {injections.length > 0 && (
        <p role="note" className="rounded-sm bg-orange-bg px-3 py-2 text-sm leading-6 text-orange">
          合同里有 {injections.length} 段像是写给 AI 的话（
          {[...new Set(injections.map((h) => h.reason))].join("、")}
          ），已在合同里用虚线框标出。检查时按普通合同文字处理，交给模型时写明这些话不是指令。正常合同里不该有这样的内容，签之前问清楚是谁加的。
        </p>
      )}
      {onPractice && state.status === "done" && cards.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-card px-4 py-3 text-sm">
          <span>拿这份报告练习怎么跟 HR 提修改，AI 扮演 HR，教练在旁边提示。</span>
          <Button size="sm" onClick={onPractice}>
            练习怎么跟 HR 谈
          </Button>
        </div>
      )}

      <div role="tablist" aria-label="切换合同和批注" className="flex gap-2 lg:hidden">
        {(
          [
            ["notes", `批注 ${cards.length}`],
            ["contract", "合同"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-sm border px-3 py-1 text-sm",
              tab === k ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className={cn(tab === "contract" ? "block" : "hidden", "lg:block")}>
          <PaperSheet title={title ?? state.docKind ?? undefined}>
            {lines.map((l, i) => {
              const m = marks.get(i);
              const style = m ? VERDICT_STYLE[m.verdict] : null;
              return (
                <p
                  key={i}
                  id={`line-${i}`}
                  onClick={m ? () => showCard(m.ids[0]) : undefined}
                  className={cn(
                    "-mx-2 rounded-sm border-l-2 border-transparent px-2",
                    style && [style.bg, style.border, "cursor-pointer"],
                    m && active && m.ids.includes(active) && "ring-1 ring-ink/25",
                    injected.has(i) && "outline-1 outline-orange outline-dashed",
                  )}
                >
                  {injected.has(i) && (
                    <span className="mr-1 rounded-sm bg-orange-bg px-1 text-xs text-orange">
                      像是写给 AI 的话
                    </span>
                  )}
                  {l}
                </p>
              );
            })}
          </PaperSheet>
        </div>

        <div className={cn(tab === "notes" ? "block" : "hidden", "space-y-4 lg:block")}>
          <details open className="group">
            <summary className="cursor-pointer text-sm font-medium select-none">
              检查记录（{state.log.length} 条）
            </summary>
            <CheckLog entries={state.log} className="mt-2" />
          </details>
          {cards.length === 0 && state.status === "done" && (
            <p className="text-sm text-ink-2">没有发现需要注意的条款。</p>
          )}
          {cards.map((f) => (
            <div key={f.id} id={`card-${f.id}`}>
              <AnnotationCard
                a={toAnnotation(f)}
                active={active === f.id}
                onLocate={firstLine.has(f.id) ? () => locate(f.id) : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
