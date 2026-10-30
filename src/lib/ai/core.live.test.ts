// 接真实接口的验收测试，约 6 次请求。不在 npm run test 里跑，手动执行：npm run test:live
// 读 .env.local 里的密钥，不打印。
import { readFileSync } from "node:fs";
import { isStepCount, tool } from "ai";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { limitsFromEnv, rolesFromEnv, type RoleConfig } from "./config";
import { createAi } from "./core";
import { UsageStore } from "./usage";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 时下面会跳过
}
const roles = rolesFromEnv();
const live = describe.skipIf(roles.length === 0);

live("真实接口", () => {
  let usage: UsageStore;
  beforeAll(() => {
    usage = new UsageStore(":memory:");
  });
  const make = (rs: RoleConfig[] = roles) =>
    createAi({ roles: rs, limits: limitsFromEnv(), usage });

  it("结构化输出：判断文书类型", async () => {
    const offer = readFileSync("data/samples/offer.md", "utf8");
    const t0 = performance.now();
    const r = await make().generateObject(
      "extract",
      z.object({
        docType: z.enum(["劳动合同", "三方协议", "录用通知", "实习协议", "其他"]),
        probationWage: z.number().nullable(),
        workCity: z.string().nullable(),
      }),
      {
        prompt: `从下面的文书里抽取：文书类型、试用期月工资（数字，没写就填 null）、工作城市。\n\n${offer}`,
      },
    );
    console.log(`结构化输出 ${(performance.now() - t0).toFixed(0)}ms`, r);
    expect(r).toMatchObject({ docType: "录用通知", probationWage: 2600 });
  }, 60_000);

  it("流式输出", async () => {
    const t0 = performance.now();
    let first = 0;
    let text = "";
    const s = make().stream("practice", {
      prompt: "你是 HR。学生问试用期能不能改成两个月，用一句话回应。",
    });
    for await (const d of s.textStream) {
      if (!first) first = performance.now() - t0;
      text += d;
    }
    const res = await s.result;
    console.log(
      `流式 首字 ${first.toFixed(0)}ms，全部 ${(performance.now() - t0).toFixed(0)}ms，角色 ${res.role}，${res.usage.outputTokens} tokens`,
    );
    expect(text.length).toBeGreaterThan(5);
  }, 60_000);

  it("工具调用", async () => {
    const r = await make().generate("execute", {
      prompt: "合同期限 2027-07-01 至 2029-06-30，试用期 3 个月。用工具检查，再用一句话说结论。",
      tools: {
        check_probation: tool({
          description: "按劳动合同法第十九条检查试用期上限",
          inputSchema: z.object({ termMonths: z.number(), probationMonths: z.number() }),
          execute: async ({ termMonths, probationMonths }) => {
            const limit = termMonths < 12 ? 1 : termMonths < 36 ? 2 : 6;
            return { limit, verdict: probationMonths > limit ? "violation" : "ok" };
          },
        }),
      },
      stopWhen: isStepCount(3),
    });
    const calls = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    console.log(`工具调用 ${calls.join(",")}，${r.steps.length} 步`);
    expect(calls).toContain("check_probation");
  }, 60_000);

  it("主模型 key 错误时自动切到复核模型", async () => {
    const main = roles.find((r) => r.role === "main");
    const alt = roles.find((r) => r.role === "alt");
    if (!main || !alt) return;
    const broken: RoleConfig = { ...main, apiKey: "invalid-key-for-test" };
    const r = await make([broken, alt]).generate("plan", { prompt: "回复两个字：收到" });
    const rows = usage.summary() as { role: string; purpose: string; ok: number; calls: number }[];
    const mainRow = rows.find((x) => x.role === "main" && x.purpose === "plan");
    console.log("切换后的回答：", r.text, "；主模型这一用途的失败记录：", mainRow);
    expect(r.text.length).toBeGreaterThan(0);
    expect(mainRow?.ok).toBe(0);
  }, 60_000);
});
