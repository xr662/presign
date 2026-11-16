// 技术文档 HTML → PDF（任务书 T21）。用本机 Edge 无头打印，A4，页脚带页码。
// 比赛要求不超过 30 页，超了就报错；还有没填的占位（class="todo"）也报错，加 --draft 可以先出草稿看排版。
// 用法：node scripts/doc-pdf.mjs [--draft]      输出 docs/技术文档.pdf（草稿是 docs/技术文档-草稿.pdf）
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const draft = process.argv.includes("--draft");
const src = resolve("docs/技术文档.html");
const out = resolve(draft ? "docs/技术文档-草稿.pdf" : "docs/技术文档.pdf");
const MAX_PAGES = 30;

const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage();
await p.goto(pathToFileURL(src).href);
await p.waitForLoadState("networkidle");

const todos = await p.locator(".todo").count();
if (todos && !draft) {
  await b.close();
  console.error(`还有 ${todos} 处占位没填（class="todo"），先填完再生成；只看排版加 --draft`);
  process.exit(1);
}
const broken = await p.evaluate(() =>
  [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
);
if (broken.length) {
  await b.close();
  console.error(`图片没有加载出来：${broken.join("、")}`);
  process.exit(1);
}

await p.pdf({
  path: out,
  format: "A4",
  preferCSSPageSize: true,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;text-align:center;font-size:8pt;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await b.close();

// PDF 里每页一个 /Type /Page 对象（/Pages 是页树，不算）
const pages = (readFileSync(out).toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
console.log(`${out}：${pages} 页${todos ? `，${todos} 处占位未填` : ""}`);
if (pages > MAX_PAGES) {
  console.error(`超过 ${MAX_PAGES} 页`);
  process.exit(1);
}
