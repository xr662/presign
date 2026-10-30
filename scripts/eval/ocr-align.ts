// 组合方案验证：模型的文字 + 本地 Tesseract 的框，按行对齐后和标准答案比。
// 先跑 ocr-coords.ts 和 ocr-tesseract.ts。只比平放截图（旋转图的标准框不准，见 ocr-coords.ts 说明）。
// 用法：node scripts/eval/ocr-align.ts labor-flat offer-flat
import { readFileSync } from "node:fs";
import { alignLines, similarity, type Box } from "../../src/features/upload/lib/align.ts";

const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (x: Box) => Math.max(0, x[2] - x[0]) * Math.max(0, x[3] - x[1]);
  return (ix * iy) / (area(a) + area(b) - ix * iy || 1);
};
for (const tag of process.argv.slice(2)) {
  const { truth, pred } = JSON.parse(readFileSync(`test-results/ocr/${tag}-run1.json`, "utf8")) as { truth: { text: string; box: Box }[]; pred: { text: string }[] };
  const local = JSON.parse(readFileSync(`test-results/ocr/${tag}-local.json`, "utf8")) as { text: string; box: Box }[];
  const aligned = alignLines(pred.map((p) => p.text), local);
  const withBox = aligned.filter((a) => a.box);
  const good = withBox.filter((a) => {
    const t = truth.reduce((b, x) => (similarity(x.text, a.text) > similarity(b.text, a.text) ? x : b), truth[0]);
    return iou(t.box, a.box!) >= 0.5;
  });
  console.log(`${tag}：模型 ${pred.length} 行，对上框的 ${withBox.length} 行（${((withBox.length / pred.length) * 100).toFixed(0)}%），其中与标准框 IoU≥0.5 的 ${good.length} 行（${((good.length / Math.max(1, withBox.length)) * 100).toFixed(0)}%）`);
}
