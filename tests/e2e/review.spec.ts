// 检查页端到端（T10 验收）：用录好的真实检查事件回放，不调模型、结果每次一样。
// 1. 示例页回放：批注卡、合同上色、点条款名定位；手机宽度下"合同 / 批注"两个标签。
// 2. /check 粘贴文字 → 开始检查：拦下 /api/review，把录像按 SSE 格式原样返回，走的是真实的读流和 reducer。
// 先 npm run build，再 npx playwright test（配置会自己起 npm run start）。
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const labor = JSON.parse(readFileSync("public/recordings/labor.json", "utf8")) as {
  text: string;
  events: unknown[];
};

test("示例页回放：出汇总和批注卡，问题条款上色，点条款名滚到合同里", async ({ page }) => {
  await page.goto("/samples/labor");
  await expect(page.getByText(/^检查了 \d+ 项/)).toBeVisible({ timeout: 30_000 });

  const cards = page.locator('[id^="card-"]');
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first()).toContainText("违法");
  // 试用期那条：第三条，违法，依据劳动合同法第十九条
  const probation = cards.filter({ hasText: "试用期" }).first();
  await expect(probation).toContainText("第三条");
  await expect(probation).toContainText("劳动合同法第十九条");

  const marked = page.locator('[id^="line-"][class*="bg-red-pen-bg"]');
  expect(await marked.count()).toBeGreaterThanOrEqual(3);

  await probation.getByRole("button", { name: "第三条" }).click();
  const line = page.locator('[id^="line-"]', { hasText: "试用期 3 个月" });
  await expect(line).toBeInViewport();
  await expect(line).toHaveClass(/ring-1/);
});

test("手机宽度：默认看批注，切到合同标签能看到上色的条款", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/samples/offer");
  await expect(page.getByText(/^检查了 \d+ 项/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[id^="card-"]').first()).toBeVisible();
  await expect(page.locator('[id^="line-"]').first()).toBeHidden();
  await page.getByRole("tab", { name: "合同" }).click();
  await expect(page.locator('[id^="line-"][class*="bg-"]').first()).toBeVisible();
});

test("/check 粘贴文字后开始检查：读 SSE，检查记录和批注卡跟着事件更新", async ({ page }) => {
  await page.route("**/api/review", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: labor.events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    }),
  );
  await page.goto("/check");
  await page.getByLabel("或者粘贴合同文字").fill(labor.text);
  await page.getByRole("button", { name: "使用这段文字" }).click();
  await page.getByRole("button", { name: "开始检查" }).click();

  await expect(page.getByText(/^检查了 \d+ 项/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/调用 check_probation：试用期/)).toBeVisible();
  expect(await page.locator('[id^="card-"]').count()).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "回到上传" }).click();
  await expect(page.getByLabel("或者粘贴合同文字")).toHaveValue(labor.text);
});

test("/check 接口返回错误时显示原因", async ({ page }) => {
  await page.route("**/api/review", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "login_required", message: "请先登录评审账号" }),
    }),
  );
  await page.goto("/check");
  await page.getByLabel("或者粘贴合同文字").fill(labor.text);
  await page.getByRole("button", { name: "使用这段文字" }).click();
  await page.getByRole("button", { name: "开始检查" }).click();
  // Next 自带一个空的 role=alert（路由播报），按文字找我们的提示
  await expect(page.getByRole("alert").filter({ hasText: "请先登录评审账号" })).toBeVisible();
});
