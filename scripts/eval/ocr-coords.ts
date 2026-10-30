// 识别坐标实验（T06 的分叉点）：模型能不能稳定给出每一行文字的框线位置。
// 用 Edge 渲染示例合同打印版，逐字取屏幕坐标、按行合并，得到标准答案；截图后交给模型识别，
// 比较文字（字错率）和框线（与标准框的 IoU）。另做一张旋转 2.5° 加灰底的"像照片"版本。
// 能稳定给出坐标就用模型出坐标；不能就把浏览器端 OCR（T16）提前。
// 用法：node scripts/eval/ocr-coords.ts [labor|offer ...] [--runs 2]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";

process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const runs = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 1;
const docs = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
if (docs.length === 0) docs.push("labor");
const NAMES: Record<string, string> = { labor: "劳动合同", tripartite: "三方协议", offer: "录用通知", internship: "实习协议" };

type Box = [number, number, number, number];
type Line = { text: string; box: Box };

const model = createOpenAICompatible({
  name: "wechat",
  baseURL: process.env.LLM_MAIN_BASE_URL!,
  apiKey: process.env.LLM_MAIN_API_KEY!,
  includeUsage: true,
  supportsStructuredOutputs: true,
})(process.env.LLM_MAIN_MODEL!);

const schema = z.object({
  lines: z.array(
    z.object({ text: z.string(), box: z.array(z.number()).length(4).describe("[x0, y0, x1, y1]") }),
  ),
});
// --pixel：告诉模型图片的像素尺寸，要求按像素给框，再换算成千分比
const pixel = args.includes("--pixel");
const PROMPT_NORM =
  "识别图片里的全部文字，按从上到下的顺序逐行输出。每一行给出原文 text（一字不改）和这一行文字在图片中的外框 box。" +
  "box 用归一化坐标 [x0, y0, x1, y1]：把图片宽和高都当作 1000，左上角是 (0,0)。";

/** 在页面里逐字取坐标，按行合并，坐标换成图片宽高为 1000 的归一化值 */
async function renderTruth(file: string, photoLike: boolean, out: string) {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
  await page.goto(pathToFileURL(file).href);
  if (photoLike) {
    await page.addStyleTag({
      content:
        "html{background:#8a8378} body{background:#fff;padding:24px;margin:40px auto;transform:rotate(2.5deg) scale(0.92);box-shadow:0 8px 30px rgba(0,0,0,.35);filter:blur(0.4px) contrast(0.92)}",
    });
  }
  const lines = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const H = window.innerHeight;
    const rows: { text: string; x0: number; y0: number; x1: number; y1: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const s = node.textContent ?? "";
      for (let i = 0; i < s.length; i++) {
        if (!s[i].trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.bottom > H || r.top < 0) continue;
        const cy = (r.top + r.bottom) / 2;
        const row = rows.find((x) => Math.abs((x.y0 + x.y1) / 2 - cy) < r.height * 0.5 && Math.abs(r.left - x.x1) < r.height * 3);
        if (row) {
          row.text += s[i];
          row.x0 = Math.min(row.x0, r.left);
          row.y0 = Math.min(row.y0, r.top);
          row.x1 = Math.max(row.x1, r.right);
          row.y1 = Math.max(row.y1, r.bottom);
        } else rows.push({ text: s[i], x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
      }
    }
    return rows.map((x) => ({
      text: x.text,
      box: [(x.x0 / W) * 1000, (x.y0 / H) * 1000, (x.x1 / W) * 1000, (x.y1 / H) * 1000],
    }));
  });
  await page.screenshot({ path: out });
  await browser.close();
  return lines as Line[];
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const strip = (s: string) => s.replace(/\s/g, "");
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const area = (x: Box) => Math.max(0, x[2] - x[0]) * Math.max(0, x[3] - x[1]);
  return inter / (area(a) + area(b) - inter || 1);
};

mkdirSync("test-results/ocr", { recursive: true });
const report: string[] = [];
for (const doc of docs) {
  for (const photoLike of [false, true]) {
    const tag = `${doc}-${photoLike ? "photo" : "flat"}${pixel ? "-px" : ""}`;
    const img = `test-results/ocr/${tag}.png`;
    const truth = await renderTruth(`docs/team/示例合同打印版/${NAMES[doc]}.html`, photoLike, img);
    for (let run = 1; run <= runs; run++) {
      const t0 = performance.now();
      const meta = readFileSync(img);
      const pw = meta.readUInt32BE(16);
      const ph = meta.readUInt32BE(20);
      const PROMPT = pixel
        ? `这张图片宽 ${pw} 像素、高 ${ph} 像素。识别图片里的全部文字，按从上到下的顺序逐行输出。每一行给出原文 text（一字不改）和这一行文字的外框 box，box 用像素坐标 [x0, y0, x1, y1]，左上角是 (0,0)。`
        : PROMPT_NORM;
      const r = await generateText({
        model,
        output: Output.object({ schema }),
        messages: [
          { role: "user", content: [{ type: "text", text: PROMPT }, { type: "file", data: readFileSync(img), mediaType: "image/png" }] },
        ],
      });
      const pred = (r.output.lines as Line[]).map((l) =>
        pixel ? { ...l, box: [(l.box[0] / pw) * 1000, (l.box[1] / ph) * 1000, (l.box[2] / pw) * 1000, (l.box[3] / ph) * 1000] as Box } : l,
      );
      const cer = levenshtein(strip(truth.map((l) => l.text).join("")), strip(pred.map((l) => l.text).join(""))) / strip(truth.map((l) => l.text).join("")).length;
      // 每条标准行找文字最接近的预测行，再算框的 IoU
      const ious = truth.map((t) => {
        let best: Line | undefined;
        let bestD = Infinity;
        for (const p of pred) {
          const d = levenshtein(strip(t.text), strip(p.text)) / Math.max(1, strip(t.text).length);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return best && bestD < 0.5 ? iou(t.box, best.box as Box) : 0;
      });
      ious.sort((a, b) => a - b);
      const median = ious[Math.floor(ious.length / 2)];
      const ok = ious.filter((x) => x >= 0.5).length / ious.length;
      const line = `${tag} 第${run}次：${((performance.now() - t0) / 1000).toFixed(1)}s，标准 ${truth.length} 行 / 识别 ${pred.length} 行，字错率 ${(cer * 100).toFixed(1)}%，框 IoU 中位数 ${median.toFixed(2)}，IoU≥0.5 的行 ${(ok * 100).toFixed(0)}%，${r.usage.inputTokens}/${r.usage.outputTokens} tokens`;
      console.log(line);
      report.push(line);
      writeFileSync(`test-results/ocr/${tag}-run${run}.json`, JSON.stringify({ truth, pred }, null, 1));
    }
  }
}
writeFileSync("test-results/ocr/report.txt", report.join("\n") + "\n");
