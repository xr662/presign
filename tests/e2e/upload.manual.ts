// 上传识别的手动端到端检查（会调真实模型接口，不放进自动测试）。
// 先启动开发服务器（端口 3001），再运行：node tests/e2e/upload.manual.ts
// 用打印版合同生成一张"像照片"的截图和一份 PDF，走一遍上传、本地识别、打码、模型识别、对齐。
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
mkdirSync("test-results/e2e", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });

// 测试素材：旋转 2.5° 加灰底的劳动合同截图，和录用通知的 PDF（有文字层）
const make = await browser.newPage({
  viewport: { width: 900, height: 1200 },
  deviceScaleFactor: 1.5,
});
await make.goto(pathToFileURL(`${process.cwd()}/eval/photos/print/劳动合同.html`).href);
await make.addStyleTag({
  content:
    "html{background:#8a8378} body{background:#fff;padding:24px;margin:40px auto;transform:rotate(2.5deg) scale(0.92);filter:blur(0.4px) contrast(0.92)}",
});
await make.screenshot({ path: "test-results/e2e/labor-photo.png" });
await make.goto(pathToFileURL(`${process.cwd()}/eval/photos/print/录用通知.html`).href);
await make.pdf({ path: "test-results/e2e/offer.pdf", format: "A4" });
await make.close();

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/check`);
await page
  .locator("input[type=file][multiple]")
  .setInputFiles(["test-results/e2e/labor-photo.png", "test-results/e2e/offer.pdf"]);
await page.getByRole("button", { name: "开始识别" }).click();
const t0 = Date.now();
await page.getByRole("heading", { name: /识别结果：2 页/ }).waitFor({ timeout: 240_000 });
// 等第二页（PDF）也出来
await page.waitForFunction(
  () => document.querySelectorAll("section[aria-label^='第']").length === 2,
  null,
  { timeout: 120_000 },
);
console.log(`识别用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const s of await page.locator("section[aria-label^='第']").all()) {
  console.log(
    `${await s.getAttribute("aria-label")}：${(await s.locator("p").first().innerText()).trim()}`,
  );
  const lines = await s.locator("ol li").allInnerTexts();
  console.log(`  前 4 行：${lines.slice(0, 4).join(" | ")}`);
  console.log(
    `  含身份证号原文：${lines.some((l) => /330106200403150010/.test(l))}，含手机号原文：${lines.some((l) => /13800138000/.test(l))}`,
  );
}
await page.screenshot({ path: "test-results/e2e/upload-result.png", fullPage: true });
console.log(
  `控制台错误 ${errors.length} 条${errors.length ? "：" + errors.slice(0, 3).join(" / ") : ""}`,
);
await browser.close();
