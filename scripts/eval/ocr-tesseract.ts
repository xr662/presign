// 对照实验：Tesseract.js（chi_sim best_int 模型，1.7MB）给出的行框和标准框比。
// 先跑 ocr-coords.ts 生成截图和标准答案（test-results/ocr/*.json）。
// 用法：node scripts/eval/ocr-tesseract.ts offer-flat labor-photo ...
import { mkdtempSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";

type Box = [number, number, number, number];
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const area = (x: Box) => Math.max(0, x[2] - x[0]) * Math.max(0, x[3] - x[1]);
  return inter / (area(a) + area(b) - inter || 1);
};

// 语言包放到临时目录，避免 tesseract 往项目里写缓存
const langDir = mkdtempSync(join(tmpdir(), "tess-"));
copyFileSync("node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz", join(langDir, "chi_sim.traineddata.gz"));

const t0 = performance.now();
const worker = await createWorker("chi_sim", 1, { langPath: langDir, cacheMethod: "none", gzip: true });
console.log(`加载 ${((performance.now() - t0) / 1000).toFixed(1)}s`);

for (const tag of process.argv.slice(2)) {
  const img = readFileSync(`test-results/ocr/${tag}.png`);
  const W = img.readUInt32BE(16);
  const H = img.readUInt32BE(20);
  const { truth } = JSON.parse(readFileSync(`test-results/ocr/${tag}-run1.json`, "utf8")) as { truth: { text: string; box: Box }[] };
  const t1 = performance.now();
  const { data } = await worker.recognize(img, {}, { blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const pred = lines.map((l) => ({
    text: l.text.replace(/\s/g, ""),
    box: [(l.bbox.x0 / W) * 1000, (l.bbox.y0 / H) * 1000, (l.bbox.x1 / W) * 1000, (l.bbox.y1 / H) * 1000] as Box,
  }));
  writeFileSync(`test-results/ocr/${tag}-local.json`, JSON.stringify(pred, null, 1));
  const best = truth.map((t) => Math.max(0, ...pred.map((p) => iou(t.box, p.box)))).sort((a, b) => a - b);
  const ok = best.filter((x) => x >= 0.5).length / best.length;
  const sample = pred.slice(0, 3).map((p) => p.text.slice(0, 12)).join(" / ");
  console.log(
    `${tag}：${((performance.now() - t1) / 1000).toFixed(1)}s，标准 ${truth.length} 行 / 识别 ${pred.length} 行，IoU 中位数 ${best[Math.floor(best.length / 2)].toFixed(2)}，IoU≥0.5 的行 ${(ok * 100).toFixed(0)}%，前几行「${sample}」`,
  );
}
await worker.terminate();
