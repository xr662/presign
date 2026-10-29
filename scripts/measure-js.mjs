// 首屏 JS 体积：打开页面，统计加载的所有脚本实际传输的字节数（压缩后）。
// 预算是首页 200KB 以内：服务器出口 2M 约 250KB/s，超出就要多等一秒以上。
// 用法：先 npm run build && npm run start，再 node scripts/measure-js.mjs / /check
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const paths = process.argv.slice(2);
if (paths.length === 0) paths.push("/");
const BUDGET_KB = 200;

const browser = await chromium.launch({ channel: "msedge" });
let over = 0;
for (const p of paths) {
  // 每个页面开新上下文，避免缓存让第二个页面的数字偏小
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  const scripts = new Map();
  cdp.on("Network.responseReceived", (e) => {
    if (e.type === "Script") scripts.set(e.requestId, 0);
  });
  cdp.on("Network.loadingFinished", (e) => {
    if (scripts.has(e.requestId)) scripts.set(e.requestId, e.encodedDataLength);
  });
  await page.goto(base + p, { waitUntil: "networkidle" });
  const kb = [...scripts.values()].reduce((a, b) => a + b, 0) / 1024;
  if (kb > BUDGET_KB) over++;
  console.log(
    `${p}  ${scripts.size} 个脚本，共 ${kb.toFixed(1)} KB${kb > BUDGET_KB ? "（超出预算）" : ""}`,
  );
  await ctx.close();
}
await browser.close();
if (over) process.exit(1);
