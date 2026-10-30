// 一页的识别流程：
//   照片 / 扫描件：缩小 → 本地 OCR（摆正、定位）→ 涂黑敏感信息 → 上传给模型识别文字 → 和本地行框对齐
//                   → 模型中途停下就把下半页裁出来再识别（最多两次）→ 剩下零星漏掉的行用本地文字补上并标出
//   PDF 有文字层：直接用文字层，不上传
// 每一步都通过 onStage 告诉界面现在在做什么。

import { mergeRecognition, type Box, type MergedLine } from "./align";
import { cropFrom, loadToCanvas, paintBlack, toJpeg } from "./image";
import { recognizeLocal } from "./local-ocr";
import { findSensitive, maskText, type Sensitive } from "./redact";

export type PageInput =
  | { kind: "image"; file: File; name: string }
  | {
      kind: "pdf";
      canvas: HTMLCanvasElement;
      lines: { text: string; box: Box }[] | null;
      name: string;
    };

export type PageResult = {
  imageUrl: string;
  width: number;
  height: number;
  angle: number;
  lines: MergedLine[];
  redactions: Sensitive[];
  modelCalls: number;
  via: "model" | "pdf-text";
};

export type Stage =
  | { step: "prepare" }
  | { step: "local"; progress: number; status: string }
  | { step: "upload"; part: number }
  | { step: "done" };

/** 服务端返回的错误原因，界面原样显示 */
export class RecognizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecognizeError";
  }
}

async function callOcr(c: HTMLCanvasElement, part: "first" | "continue"): Promise<string[]> {
  const form = new FormData();
  form.set("image", await toJpeg(c), "page.jpg");
  form.set("part", part);
  let res: Response;
  try {
    res = await fetch("/api/ocr", { method: "POST", body: form });
  } catch {
    throw new RecognizeError("网络连接断了，请检查网络后重试。");
  }
  const body = (await res.json().catch(() => null)) as {
    lines?: string[];
    message?: string;
  } | null;
  if (!res.ok || !body?.lines)
    throw new RecognizeError(body?.message ?? `识别失败（${res.status}），请重试。`);
  return body.lines;
}

const MAX_CONTINUE = 2;

export async function recognizePage(
  input: PageInput,
  onStage: (s: Stage) => void,
): Promise<PageResult> {
  onStage({ step: "prepare" });

  if (input.kind === "pdf" && input.lines) {
    // 有文字层：文字和位置都现成，敏感信息在文字上换成 □
    onStage({ step: "done" });
    return {
      imageUrl: input.canvas.toDataURL("image/jpeg", 0.85),
      width: input.canvas.width,
      height: input.canvas.height,
      angle: 0,
      lines: input.lines.map((l) => ({
        text: maskText(l.text),
        box: l.box,
        source: "model" as const,
      })),
      redactions: [],
      modelCalls: 0,
      via: "pdf-text",
    };
  }

  const source = input.kind === "image" ? await loadToCanvas(input.file) : input.canvas;
  let local;
  try {
    local = await recognizeLocal(source, (p) =>
      onStage({ step: "local", progress: p.progress, status: p.status }),
    );
  } catch {
    throw new RecognizeError("本地识别组件没有加载成功，请检查网络后刷新页面重试。");
  }
  const { canvas, angle } = local;
  const redactions = findSensitive(local.lines);
  paintBlack(
    canvas,
    redactions.map((r) => r.box),
  );
  const localLines = local.lines.map((l) => ({ text: l.text, box: l.box }));

  onStage({ step: "upload", part: 1 });
  let modelCalls = 1;
  const first = mergeRecognition(await callOcr(canvas, "first"), localLines);
  const lines: MergedLine[] = [...first.lines];
  let resume = first.resumeFromY;
  for (let i = 0; resume !== null && i < MAX_CONTINUE; i++) {
    onStage({ step: "upload", part: i + 2 });
    modelCalls++;
    const y0 = resume - 8;
    const rest = localLines.filter((l) => l.box[1] >= y0);
    const more = mergeRecognition(await callOcr(cropFrom(canvas, y0), "continue"), rest);
    lines.push(...more.lines);
    resume = more.resumeFromY;
  }
  // 续识别次数用完还有没识别的行：用本地文字补上，界面标出来让用户核对
  if (resume !== null) {
    for (const l of localLines.filter((x) => x.box[1] >= resume! - 8)) {
      if (l.text.replace(/\s/g, "").length >= 2)
        lines.push({ text: l.text, box: l.box, source: "local" });
    }
  }

  onStage({ step: "done" });
  return {
    imageUrl: canvas.toDataURL("image/jpeg", 0.85),
    width: canvas.width,
    height: canvas.height,
    angle,
    lines: lines.map((l) => ({ ...l, text: maskText(l.text) })),
    redactions,
    modelCalls,
    via: "model",
  };
}
