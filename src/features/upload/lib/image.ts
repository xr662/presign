// 浏览器里的图片处理：按拍照方向摆正、缩小、压成 JPEG、裁剪、涂黑。

import type { Box } from "./align";

/** 读入图片：按 EXIF 方向摆正，长边缩到 maxSide 以内。本地 OCR 和上传都用这张 */
export async function loadToCanvas(file: Blob, maxSide = 2000): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export async function canvasFromSrc(src: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

function scaled(c: HTMLCanvasElement, f: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.round(c.width * f);
  out.height = Math.round(c.height * f);
  out.getContext("2d")!.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

/** 压成 JPEG，不超过 maxBytes（服务端上限 1.5MB，留余量）。质量降到 0.55 还大就缩小尺寸 */
export async function toJpeg(c: HTMLCanvasElement, maxBytes = 1_200_000): Promise<Blob> {
  for (const q of [0.85, 0.75, 0.65, 0.55]) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
    if (b && b.size <= maxBytes) return b;
  }
  return toJpeg(scaled(c, 0.75), maxBytes);
}

/** 从 y0 往下裁出一张新图（模型中途停下时，把没识别的下半页再送一次） */
export function cropFrom(c: HTMLCanvasElement, y0: number): HTMLCanvasElement {
  const top = Math.max(0, Math.floor(y0));
  const out = document.createElement("canvas");
  out.width = c.width;
  out.height = c.height - top;
  out.getContext("2d")!.drawImage(c, 0, top, c.width, out.height, 0, 0, c.width, out.height);
  return out;
}

/** 在图上涂黑（打码）。直接改这张画布，上传和显示用的都是涂过的 */
export function paintBlack(c: HTMLCanvasElement, boxes: Box[]) {
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
}
