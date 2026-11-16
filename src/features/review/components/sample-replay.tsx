"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveScenario, scenarioFromFindings } from "@/features/practice/scenario";
import type { ReviewEvent } from "@/lib/review/events";
import { visibleFindings } from "../state";
import { useReview } from "../use-review";
import { ReviewView } from "./review-view";

// 示例合同的检查过程回放：读录好的事件，按原来的先后两倍速重放（长时间等待压到 1.5 秒）。
// 录像是真实检查录下来的，回放时不调用模型。

type Recording = { recordedAt: string; text: string; events: ReviewEvent[] };

export function SampleReplay({ id, title }: { id: string; title: string }) {
  const { state, replay } = useReview();
  const router = useRouter();
  const [rec, setRec] = useState<Recording | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/recordings/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Recording>) : Promise.reject(new Error())))
      .then((d) => {
        if (!alive) return;
        setRec(d);
        void replay(d.events);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id, replay]);

  if (failed)
    return <p className="text-sm text-red-pen">示例的检查记录没有加载出来，请刷新重试。</p>;
  if (!rec) return <p className="text-sm text-ink-2">正在加载示例合同</p>;

  const lines = rec.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
        <span>
          这是 {rec.recordedAt} 用 Deepseek-v4-flash
          实际检查这份合同时录下的过程，两倍速回放，不调用模型。
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void replay(rec.events)}
          disabled={state.status === "running"}
        >
          重新播放
        </Button>
      </div>
      <ReviewView
        lines={lines}
        state={state}
        title={title}
        onPractice={() => {
          saveScenario(scenarioFromFindings(state.docKind, visibleFindings(state)));
          router.push("/practice");
        }}
      />
    </div>
  );
}
