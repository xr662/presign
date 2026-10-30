"use client";

// 检查页用的 hook：start 发起一次真实检查（POST /api/review，读 SSE），replay 按原来的时间间隔回放录好的事件。
// 两种来源都喂给同一个 reducer（state.ts），界面不区分。

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ReviewEvent } from "@/lib/review/events";
import { initialReview, reduceReview } from "./state";

/** 把 SSE 字节流切成事件。只认 "data: " 开头的行，按空行分隔 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ReviewEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) yield JSON.parse(chunk.slice(6)) as ReviewEvent;
    }
  }
}

export function useReview() {
  const [state, dispatch] = useReducer(reduceReview, initialReview);
  const ctl = useRef<AbortController | null>(null);

  // 离开页面时停掉进行中的检查或回放
  useEffect(() => () => ctl.current?.abort(), []);

  const begin = useCallback(() => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    dispatch({ type: "start" });
    return ctl.current.signal;
  }, []);

  const start = useCallback(
    async (text: string) => {
      const signal = begin();
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          dispatch({
            type: "error",
            at: 0,
            code: body?.error ?? `http_${res.status}`,
            message: body?.message ?? `检查没有开始（服务器返回 ${res.status}），请稍后再试。`,
          });
          return;
        }
        for await (const e of readSse(res.body)) dispatch(e);
      } catch {
        if (signal.aborted) return;
        dispatch({
          type: "error",
          at: 0,
          code: "network",
          message: "和服务器的连接断了，请检查网络后重新检查。",
        });
      }
    },
    [begin],
  );

  /** 回放：speed 为 2 时两倍速；间隔超过 maxGapMs 的按 maxGapMs 等，示例不用干等模型 */
  const replay = useCallback(
    async (events: ReviewEvent[], speed = 2, maxGapMs = 1500) => {
      const signal = begin();
      let last = 0;
      for (const e of events) {
        const wait = Math.min((e.at - last) / speed, maxGapMs);
        last = e.at;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (signal.aborted) return;
        dispatch(e);
      }
    },
    [begin],
  );

  const cancel = useCallback(() => ctl.current?.abort(), []);

  return { state, start, replay, cancel };
}
