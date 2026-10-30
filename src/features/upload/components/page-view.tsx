"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PageResult } from "../lib/recognize";

// 识别结果：左边是图片（已打码），每一行的框画在上面；右边是逐行文字。
// 模型漏掉、用本地识别补上的行标橙色，提示用户对照原图核对。

export function PageView({ page, index }: { page: PageResult; index: number }) {
  const [active, setActive] = useState<number | null>(null);
  const toCheck = page.lines.filter((l) => l.source === "local").length;

  return (
    <section
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
      aria-label={`第 ${index + 1} 页`}
    >
      <div className="relative overflow-hidden rounded-sm border border-line bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地生成的 data URL，不走图片优化 */}
        <img
          src={page.imageUrl}
          alt={`第 ${index + 1} 页识别用的图片，敏感信息已涂黑`}
          className="block w-full"
        />
        <svg
          viewBox={`0 0 ${page.width} ${page.height}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {page.lines.map((l, i) =>
            l.box ? (
              <rect
                key={i}
                x={l.box[0]}
                y={l.box[1]}
                width={l.box[2] - l.box[0]}
                height={l.box[3] - l.box[1]}
                className={cn(
                  "fill-transparent",
                  l.source === "local" ? "stroke-orange" : "stroke-focus/50",
                  active === i && "fill-focus/15 stroke-focus",
                )}
                strokeWidth={Math.max(2, page.width / 600)}
              />
            ) : null,
          )}
        </svg>
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-sm text-ink-2">
          {page.via === "pdf-text"
            ? "PDF 自带文字，没有经过识别"
            : `识别了 ${page.lines.length} 行`}
          {page.angle !== 0 &&
            Math.abs(page.angle) > 0.05 &&
            `，图片摆正了 ${Math.abs(page.angle).toFixed(1)}°`}
          {page.redactions.length > 0 && `，涂黑了 ${page.redactions.length} 处个人信息`}
          {toCheck > 0 && <span className="text-orange">，{toCheck} 行请对照原图核对</span>}
        </p>
        <ol className="max-h-[32rem] space-y-0.5 overflow-y-auto rounded-sm border border-line bg-card p-2 text-sm leading-6">
          {page.lines.map((l, i) => (
            <li
              key={i}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={cn("rounded-sm px-1.5", active === i && "bg-paper-2")}
            >
              {l.source === "local" && (
                <span className="mr-1 rounded-sm bg-orange-bg px-1 text-xs text-orange">
                  请核对
                </span>
              )}
              {l.text}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
