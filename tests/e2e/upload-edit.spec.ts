// 识别结果可以改（11-01 Rui 实测：标了"请核对"的行没地方改）。
// 用带文字层的 PDF 走上传：这条路不调模型、不跑本地识别，结果每次一样。PDF 在测试里现生成，不进仓库。
// 改一行、删一行、回车加一行，再点"开始检查"，拦下 /api/review 看送出去的是不是改后的文字。
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const labor = JSON.parse(readFileSync("public/recordings/labor.json", "utf8")) as {
  events: unknown[];
};

// 每页要有 30 个字以上才算有文字层（pdf-lines.ts 的 MIN_TEXT_LAYER_CHARS）。
// 汉字和数字之间不放空格：PDF 抽出来的文字空格不一定原样保留，比对会不稳。
const LINES = [
  "一、合同期限自二〇二七年七月一日起至二〇二九年六月三十日止",
  "试用期三个月",
  "这一行要删掉",
  "二、工作内容乙方担任产品运营岗位",
];

test("识别结果逐行改：改字、清空删行、回车加行，开始检查用改后的文字", async ({
  page,
  browser,
}) => {
  const maker = await browser.newPage();
  await maker.setContent(
    `<body style="font: 20px sans-serif; padding: 40px">${LINES.map((l) => `<p>${l}</p>`).join("")}</body>`,
  );
  const pdf = await maker.pdf({ format: "A4" });
  await maker.close();

  let sent = "";
  await page.route("**/api/review", (route) => {
    sent = (route.request().postDataJSON() as { text: string }).text;
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: labor.events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    });
  });

  await page.goto("/check");
  await page
    .locator('input[type="file"][accept*="pdf"]')
    .setInputFiles({ name: "合同.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "开始识别" }).click();

  const line = (text: string) => page.getByRole("textbox").filter({ hasText: text });
  await expect(line("试用期三个月")).toBeVisible({ timeout: 30_000 });

  // 改字：离开这一行才生效，生效后标"改过"
  await line("试用期三个月").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("试用期两个月");
  await page.keyboard.press("Tab");
  await expect(line("试用期两个月")).toBeVisible();
  await expect(page.getByText("改过")).toHaveCount(1);

  // 清空就是删掉
  await line("这一行要删掉").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Tab");
  await expect(line("这一行要删掉")).toHaveCount(0);

  // 回车在下面加一行，光标直接进新行
  await line("二、工作内容").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("新加的一行");
  await page.keyboard.press("Tab");
  await expect(line("新加的一行")).toBeVisible();
  await expect(page.getByText(/改了 2 行/)).toBeVisible();

  await page.getByRole("button", { name: "开始检查" }).click();
  await expect(page.getByText(/^检查了 \d+ 项/)).toBeVisible({ timeout: 15_000 });
  expect(sent.split("\n")).toEqual([LINES[0], "试用期两个月", LINES[3], "新加的一行"]);
});
