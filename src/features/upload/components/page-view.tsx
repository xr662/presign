"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { MergedLine } from "../lib/align";
import { addLineBelow, editLine } from "../lib/edit-lines";
import type { PageResult } from "../lib/recognize";

// 识别结果：左边是图片（已打码），每一行的框画在上面；右边是逐行文字，点一行就能改，送去检查的是改后的文字。
// 模型漏掉、用本地识别补上的行标橙色，提示用户对照原图核对。
//
// 每行用 contentEditable，不用 input：合同的一行常有三四十个字，input 不换行，手机上看不全。
// 编辑过程中这一行不受 React 控制，离开这一行时才把文字交回去。key 里带上文字，文字一变就重新挂载，
// 免得 React 去更新已经被浏览器改过的文本节点（那样会出现重复的字）。

type Props = {
  page: PageResult;
  index: number;
  /** 不传就只能看不能改 */
  onLinesChange?: (lines: MergedLine[]) => void;
};

export function PageView({ page, index, onLinesChange }: Props) {
  const [active, setActive] = useState<number | null>(null);
  // 回车新加的行挂载时把光标放进去（在 ref 回调里做，不用 effect 里 setState）
  const pendingFocus = useRef<number | null>(null);
  const toCheck = page.lines.filter((l) => l.source === "local").length;
  const edited = page.lines.filter((l) => l.source === "user").length;
  const editable = Boolean(onLinesChange);

  const commit = (i: number, text: string) => {
    const next = editLine(page.lines, i, text);
    if (next !== page.lines) onLinesChange?.(next);
  };

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
        <p className="mb-1 text-sm text-ink-2">
          {page.via === "pdf-text"
            ? "PDF 自带文字，没有经过识别"
            : `识别了 ${page.lines.length} 行`}
          {page.angle !== 0 &&
            Math.abs(page.angle) > 0.05 &&
            `，图片摆正了 ${Math.abs(page.angle).toFixed(1)}°`}
          {page.redactions.length > 0 && `，涂黑了 ${page.redactions.length} 处个人信息`}
          {toCheck > 0 && <span className="text-orange">，{toCheck} 行请对照原图核对</span>}
          {edited > 0 && `，改了 ${edited} 行`}
        </p>
        {editable && (
          <p className="mb-2 text-xs leading-5 text-ink-2">
            和原图不一样的字，点那一行直接改。按回车在下面加一行，把一行清空就是删掉它。
          </p>
        )}
        <ol className="max-h-[32rem] space-y-0.5 overflow-y-auto rounded-sm border border-line bg-card p-2 text-sm leading-6">
          {page.lines.map((l, i) => (
            <li
              key={`${i}:${l.text}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                "flex items-baseline gap-1 rounded-sm px-1.5",
                active === i && "bg-paper-2",
              )}
            >
              {l.source === "local" && (
                <span className="shrink-0 rounded-sm bg-orange-bg px-1 text-xs text-orange">
                  请核对
                </span>
              )}
              {l.source === "user" && (
                <span className="shrink-0 rounded-sm border border-line px-1 text-xs text-ink-2">
                  改过
                </span>
              )}
              {editable ? (
                <span
                  ref={(el) => {
                    if (el && pendingFocus.current === i) {
                      pendingFocus.current = null;
                      el.focus();
                    }
                  }}
                  role="textbox"
                  aria-label={`第 ${index + 1} 页第 ${i + 1} 行`}
                  contentEditable="plaintext-only"
                  suppressContentEditableWarning
                  spellCheck={false}
                  className="block min-h-6 min-w-0 flex-1 cursor-text rounded-sm px-1 outline-none focus:bg-paper-2 focus:ring-1 focus:ring-focus"
                  onFocus={() => setActive(i)}
                  onBlur={(e) => {
                    setActive(null);
                    commit(i, e.currentTarget.textContent ?? "");
                  }}
                  onKeyDown={(e) => {
                    // 输入法选字时按的回车不算（Safari 选字结束那一下 isComposing 已是 false，keyCode 是 229）
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape") {
                      e.currentTarget.textContent = l.text;
                      e.currentTarget.blur();
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const r = addLineBelow(page.lines, i, e.currentTarget.textContent ?? "");
                      if (!r) return;
                      pendingFocus.current = r.focus;
                      onLinesChange?.(r.lines);
                    }
                  }}
                >
                  {l.text}
                </span>
              ) : (
                <span className="min-w-0 flex-1">{l.text}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
