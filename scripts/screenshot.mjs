// 页面截图：桌面 1440 宽、手机 390 宽各一张整页图，给验收、技术文档和视频用。
// 用本机 Edge（不另装浏览器）。截图只写到 test-results/shots/，每次覆盖，不会越积越多。
// 用法：先 npm run build && npm run start，再 node scripts/screenshot.mjs / /check /about
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const paths = process.argv.slice(2);
if (paths.length === 0) paths.push("/");

const outDir = "test-results/shots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const sizes = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
];

for (const size of sizes) {
  const ctx = await browser.newContext(size);
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    const file = `${outDir}/${size.name}${p === "/" ? "-home" : p.replaceAll("/", "-")}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
