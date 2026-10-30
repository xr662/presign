"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_PAGES, readPdf } from "../lib/pdf";
import {
  recognizePage,
  RecognizeError,
  type PageInput,
  type PageResult,
  type Stage,
} from "../lib/recognize";
import { PageView } from "./page-view";

// 上传和识别。照片、PDF 可以混着加，最多 6 页，可以调顺序、删掉；也可以直接粘贴文字。
// 识别一页一页做，每页显示当前在做哪一步；出错时显示原因，其他页不受影响。

type Item = {
  id: string;
  name: string;
  thumb: string;
  input: PageInput;
  status: "waiting" | "working" | "done" | "error";
  stage?: Stage;
  result?: PageResult;
  error?: string;
};

const stageText = (s?: Stage) => {
  if (!s) return "等待识别";
  if (s.step === "prepare") return "准备图片";
  if (s.step === "local")
    return s.status.includes("loading") || s.status.includes("initializ")
      ? `第一次使用，正在下载本地识别组件（约 3MB）${s.progress ? ` ${Math.round(s.progress * 100)}%` : ""}`
      : `本地定位文字、检查个人信息 ${Math.round(s.progress * 100)}%`;
  if (s.step === "upload") return s.part === 1 ? "上传识别" : `补识别下半页（第 ${s.part - 1} 次）`;
  return "完成";
};

let seq = 0;
const newId = () => `p${++seq}`;

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteLines, setPasteLines] = useState<string[] | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null);
    const added: Item[] = [];
    for (const f of Array.from(files)) {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
        try {
          const { pages, totalPages } = await readPdf(f);
          pages.forEach((p, i) =>
            added.push({
              id: newId(),
              name: `${f.name} 第 ${i + 1} 页`,
              thumb: p.canvas.toDataURL("image/jpeg", 0.5),
              input: { kind: "pdf", canvas: p.canvas, lines: p.lines, name: f.name },
              status: "waiting",
            }),
          );
          if (totalPages > MAX_PAGES)
            setNotice(`${f.name} 有 ${totalPages} 页，只取前 ${MAX_PAGES} 页。`);
        } catch {
          setNotice(`${f.name} 打不开，可能已损坏或设置了密码。`);
        }
      } else if (f.type.startsWith("image/")) {
        added.push({
          id: newId(),
          name: f.name,
          thumb: URL.createObjectURL(f),
          input: { kind: "image", file: f, name: f.name },
          status: "waiting",
        });
      } else {
        setNotice(`${f.name} 不是图片或 PDF，已跳过。`);
      }
    }
    setItems((xs) => {
      const all = [...xs, ...added];
      if (all.length > MAX_PAGES) setNotice(`一次最多 ${MAX_PAGES} 页，多出来的没有加进来。`);
      return all.slice(0, MAX_PAGES);
    });
  }

  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const ys = [...xs];
      [ys[i], ys[j]] = [ys[j], ys[i]];
      return ys;
    });

  async function run() {
    setRunning(true);
    setNotice(null);
    for (const it of items) {
      if (it.status === "done") continue;
      update(it.id, { status: "working", error: undefined });
      try {
        const result = await recognizePage(it.input, (stage) => update(it.id, { stage }));
        update(it.id, { status: "done", result });
      } catch (e) {
        const msg = e instanceof RecognizeError ? e.message : "这一页没有识别出来，请重试。";
        update(it.id, { status: "error", error: msg });
        // 额度用完时后面的页也会失败，不再继续
        if (msg.includes("用完了")) break;
      }
    }
    setRunning(false);
  }

  const done = items.filter((x) => x.status === "done");
  const totalLines = done.reduce((n, x) => n + (x.result?.lines.length ?? 0), 0);

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-dashed border-line bg-card p-6 text-center">
        <p className="text-sm text-ink-2">照片、PDF 都可以，最多 {MAX_PAGES} 页</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Button onClick={() => cameraRef.current?.click()} disabled={running}>
            拍照
          </Button>
          <Button variant="outline" onClick={() => pickRef.current?.click()} disabled={running}>
            选择照片或 PDF
          </Button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={pickRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-4 text-xs leading-5 text-ink-2">
          上传前，身份证号、手机号、银行卡号、邮箱会先在你的浏览器里识别并涂黑，涂过的图片才会发出去。识别结果里请再看一眼有没有漏涂的。
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-sm bg-orange-bg px-3 py-2 text-sm text-orange">
          {notice}
        </p>
      )}

      {items.length > 0 && (
        <div>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {items.map((it, i) => (
              <li key={it.id} className="rounded-sm border border-line bg-card p-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element -- 本地文件预览 */}
                <img
                  src={it.thumb}
                  alt={it.name}
                  className="aspect-[3/4] w-full rounded-sm object-cover"
                />
                <p className="mt-1 truncate text-ink-2">第 {i + 1} 页</p>
                <p
                  aria-live="polite"
                  className={cn(
                    "mt-0.5 leading-4",
                    it.status === "error"
                      ? "text-red-pen"
                      : it.status === "done"
                        ? "text-ok"
                        : "text-ink-2",
                  )}
                >
                  {it.status === "error"
                    ? it.error
                    : it.status === "waiting"
                      ? "等待识别"
                      : stageText(it.stage)}
                </p>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    className="px-1 text-ink-2 hover:text-ink disabled:opacity-40"
                    onClick={() => move(i, -1)}
                    disabled={running || i === 0}
                    aria-label="往前挪"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="px-1 text-ink-2 hover:text-ink disabled:opacity-40"
                    onClick={() => move(i, 1)}
                    disabled={running || i === items.length - 1}
                    aria-label="往后挪"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="ml-auto px-1 text-ink-2 hover:text-red-pen disabled:opacity-40"
                    onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}
                    disabled={running}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Button
            className="mt-4"
            onClick={() => void run()}
            disabled={running || items.every((x) => x.status === "done")}
          >
            {running
              ? "识别中"
              : items.some((x) => x.status === "error")
                ? "重试没识别出来的页"
                : "开始识别"}
          </Button>
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            识别结果：{done.length} 页，{totalLines} 行
          </h2>
          {items.map((it, i) =>
            it.result ? <PageView key={it.id} page={it.result} index={i} /> : null,
          )}
        </div>
      )}

      <div>
        <label htmlFor="paste" className="text-sm font-medium">
          或者粘贴合同文字
        </label>
        <textarea
          id="paste"
          rows={6}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          className="mt-2 w-full rounded-md border border-line bg-card p-3 text-sm leading-6"
          placeholder="把合同全文粘贴到这里"
        />
        <Button
          className="mt-3"
          variant="outline"
          disabled={!pasted.trim()}
          onClick={() =>
            setPasteLines(
              pasted
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean),
            )
          }
        >
          使用这段文字
        </Button>
        {pasteLines && <p className="mt-2 text-sm text-ink-2">收到 {pasteLines.length} 行文字。</p>}
      </div>
    </div>
  );
}
