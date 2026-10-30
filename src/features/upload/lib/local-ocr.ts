// 浏览器本地 OCR（Tesseract.js，中文 best_int 模型）。用途有两个：
// 1. 上传前找出身份证号等敏感信息，先涂黑再上传；
// 2. 给每一行文字定位，模型识别的文字靠它对上图片里的位置。
// 照片里的文字有倾斜时，rotateAuto 会先摆正（10-30 实验测出 2.5° 的倾斜，误差 0.02°），
// 之后的框线、打码、上传都基于摆正后的图。
// 文件放在本站 public/vendor/ocr/，第一次用时下载约 3MB，之后浏览器缓存。

import type { Worker } from "tesseract.js";
import type { Box } from "./align";
import { canvasFromSrc } from "./image";
import type { OcrWordLine } from "./redact";

export type LocalProgress = { status: string; progress: number };
const listeners = new Set<(p: LocalProgress) => void>();
let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    // worker 用 blob 地址启动，相对路径解析不了，所以写成完整网址
    const base = `${window.location.origin}/vendor/ocr`;
    return createWorker("chi_sim", 1, {
      workerPath: `${base}/worker.min.js`,
      corePath: `${base}/core`,
      langPath: `${base}/lang`,
      gzip: true,
      logger: (m) => listeners.forEach((l) => l({ status: m.status, progress: m.progress })),
    });
  })().catch((e) => {
    workerPromise = null; // 下载失败时允许重试
    throw e;
  });
  return workerPromise;
}

export type LocalResult = {
  canvas: HTMLCanvasElement; // 摆正后的图
  angle: number; // 摆正转了多少度
  lines: OcrWordLine[];
};

const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): Box => [
  b.x0,
  b.y0,
  b.x1,
  b.y1,
];

export async function recognizeLocal(
  input: HTMLCanvasElement,
  onProgress?: (p: LocalProgress) => void,
): Promise<LocalResult> {
  if (onProgress) listeners.add(onProgress);
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(
      input,
      { rotateAuto: true },
      { blocks: true, imageColor: true },
    );
    const angle = ((data.rotateRadians ?? 0) * 180) / Math.PI;
    // 转过的话用 Tesseract 摆正后的图，框线坐标对的是这张
    let canvas = input;
    if (data.imageColor && Math.abs(angle) > 0.05) {
      const src = data.imageColor.startsWith("data:")
        ? data.imageColor
        : `data:image/png;base64,${data.imageColor}`;
      canvas = await canvasFromSrc(src);
    }
    const lines: OcrWordLine[] = (data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.map((l) => ({
          text: l.text.trim(),
          box: toBox(l.bbox),
          words: l.words.map((w) => ({ text: w.text, box: toBox(w.bbox) })),
        })),
      ),
    );
    return { canvas, angle, lines: lines.filter((l) => l.text) };
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
}
