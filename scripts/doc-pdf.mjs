// 技术文档 HTML → PDF（任务书 T21）。用本机 Edge 无头打印，A4，页脚带页码。
// 比赛要求不超过 30 页，超了就报错；还有没填的占位（class="todo"）也报错，加 --draft 可以先出草稿看排版。
// 用法：node scripts/doc-pdf.mjs [--draft]      输出 docs/技术文档.pdf（草稿是 docs/技术文档-草稿.pdf）
//       node scripts/doc-pdf.mjs --demo <演示地址> --out <仓库外的路径>
// 交给评委的那份封面要写演示地址，评委才打得开；仓库是公开的，不能写（11-18 Rui）。
// 所以地址只在打印时填进封面 data-demo 那一行，而且输出路径必须在仓库目录外，免得带地址的 PDF 被提交。
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const draft = process.argv.includes("--draft");
const demo = argOf("--demo");
const outArg = argOf("--out");
const src = resolve("docs/技术文档.html");
const out = resolve(outArg ?? (draft ? "docs/技术文档-草稿.pdf" : "docs/技术文档.pdf"));
const MAX_PAGES = 30;

if (demo !== undefined) {
  if (!/^https?:\/\/\S+$/.test(demo)) fail(`--demo 要写完整网址（https://...），收到的是：${demo}`);
  if (!outArg) fail("带 --demo 时要用 --out 指定输出路径，放在仓库目录外面");
  const rel = relative(process.cwd(), out);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    fail(`带演示地址的 PDF 不能放在仓库目录里：${out}`);
}

const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage();
await p.goto(pathToFileURL(src).href);
await p.waitForLoadState("networkidle");

const todos = await p.locator(".todo").count();
if (todos && !draft) {
  await b.close();
  fail(`还有 ${todos} 处占位没填（class="todo"），先填完再生成；只看排版加 --draft`);
}
const broken = await p.evaluate(() =>
  [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
);
if (broken.length) {
  await b.close();
  fail(`图片没有加载出来：${broken.join("、")}`);
}

if (demo !== undefined) {
  const line = p.locator("[data-demo]");
  if ((await line.count()) !== 1) {
    await b.close();
    fail("封面上找不到演示地址那一行（data-demo）");
  }
  await line.evaluate((el, url) => {
    el.textContent = `在线演示：${url}（评审账号见提交表）`;
  }, demo);
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
const pages = (
  readFileSync(out)
    .toString("latin1")
    .match(/\/Type\s*\/Page(?!s)/g) ?? []
).length;
console.log(`${out}：${pages} 页${todos ? `，${todos} 处占位未填` : ""}`);
if (pages > MAX_PAGES) fail(`超过 ${MAX_PAGES} 页`);
