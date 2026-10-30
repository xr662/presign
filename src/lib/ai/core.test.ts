// 接入层测试：全部用模拟模型，不发真实请求。
// 覆盖：主模型失败切复核、没配 key 时跳过、格式错误重试一次、预算超限不调用、流式切换。
import { APICallError, simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chainFor, limitsFromEnv, rolesFromEnv, type RoleConfig } from "./config";
import { createAi } from "./core";
import {
  AllModelsFailedError,
  BudgetExceededError,
  NoModelAvailableError,
  StructuredOutputError,
} from "./errors";
import { dayStartCN, UsageStore } from "./usage";

const tokens = (i: number, o: number) => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});
const stop = { unified: "stop" as const, raw: undefined };

function replies(texts: string[]) {
  const calls = { n: 0 };
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const text = texts[Math.min(calls.n, texts.length - 1)];
      calls.n++;
      return {
        content: [{ type: "text", text }],
        finishReason: stop,
        usage: tokens(10, 20),
        warnings: [],
      };
    },
  });
  return { model, calls };
}

const apiError = (status: number) =>
  new APICallError({
    message: `HTTP ${status}`,
    url: "https://chatapi.example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: status,
    isRetryable: false,
  });

function failing(status: number) {
  const calls = { n: 0 };
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls.n++;
      throw apiError(status);
    },
    doStream: async () => {
      calls.n++;
      throw apiError(status);
    },
  });
  return { model, calls };
}

const role = (r: RoleConfig["role"]): RoleConfig => ({
  role: r,
  baseURL: "https://chatapi.example.com/openai/v1",
  apiKey: `key-${r}`,
  model: "Deepseek-v4-flash",
});
const limits = limitsFromEnv({});

function setup(
  models: Partial<Record<RoleConfig["role"], LanguageModel>>,
  roles = [role("main"), role("alt")],
  now = () => Date.UTC(2026, 9, 30, 4),
) {
  const usage = new UsageStore(":memory:");
  const ai = createAi({
    roles,
    limits,
    usage,
    modelFor: (r) => models[r.role]!,
    maxRetries: 0,
    now,
  });
  return { ai, usage };
}

describe("角色配置", () => {
  const env = {
    LLM_MAIN_BASE_URL: "https://chatapi.example.com/openai/v1",
    LLM_MAIN_API_KEY: "",
    LLM_MAIN_MODEL: "Deepseek-v4-flash",
    LLM_ALT_BASE_URL: "https://chatapi.example.com/openai/v1",
    LLM_ALT_API_KEY: "k",
    LLM_ALT_MODEL: "Deepseek-v4-flash",
    LLM_ALT_REASONING_EFFORT: "high",
  };
  it("没填 key 的角色不出现", () => {
    expect(rolesFromEnv(env).map((r) => r.role)).toEqual(["alt"]);
  });
  it("思考强度只认 low / medium / high", () => {
    expect(rolesFromEnv(env)[0].reasoningEffort).toBe("high");
    expect(
      rolesFromEnv({ ...env, LLM_ALT_REASONING_EFFORT: "max" })[0].reasoningEffort,
    ).toBeUndefined();
  });
  it("自检和谈判练习先用复核角色", () => {
    const roles = [role("main"), role("alt")];
    expect(chainFor("verify", roles).map((r) => r.role)).toEqual(["alt", "main"]);
    expect(chainFor("plan", roles).map((r) => r.role)).toEqual(["main", "alt"]);
  });
});

describe("失败切换", () => {
  it("主模型 401 时切到复核模型，两次都记账", async () => {
    const main = failing(401);
    const alt = replies(["好"]);
    const { ai, usage } = setup({ main: main.model, alt: alt.model });
    const r = await ai.generate("plan", { prompt: "测试" });
    expect(r.text).toBe("好");
    expect(main.calls.n).toBe(1);
    const rows = usage.summary(Date.UTC(2026, 9, 30, 4)) as { role: string; ok: number }[];
    expect(rows.find((x) => x.role === "main")?.ok).toBe(0);
    expect(rows.find((x) => x.role === "alt")?.ok).toBe(1);
  });

  it("拔掉主模型 key：直接用复核模型，主模型一次都不调", async () => {
    const main = replies(["不该用到"]);
    const alt = replies(["复核"]);
    const roles = rolesFromEnv({
      LLM_MAIN_BASE_URL: "https://chatapi.example.com/openai/v1",
      LLM_MAIN_MODEL: "m",
      LLM_ALT_BASE_URL: "https://chatapi.example.com/openai/v1",
      LLM_ALT_API_KEY: "k",
      LLM_ALT_MODEL: "m",
    });
    const { ai } = setup({ main: main.model, alt: alt.model }, roles);
    expect((await ai.generate("plan", { prompt: "测试" })).text).toBe("复核");
    expect(main.calls.n).toBe(0);
  });

  it("全部失败时报 AllModelsFailedError，列出试过的角色", async () => {
    const { ai } = setup({ main: failing(500).model, alt: failing(503).model });
    await expect(ai.generate("plan", { prompt: "测试" })).rejects.toMatchObject({
      name: "AllModelsFailedError",
      tried: ["main", "alt"],
    });
  });

  it("一个模型都没配置", async () => {
    const { ai } = setup({}, []);
    await expect(ai.generate("plan", { prompt: "测试" })).rejects.toBeInstanceOf(
      NoModelAvailableError,
    );
  });
});

describe("结构化输出", () => {
  const schema = z.object({ docType: z.enum(["劳动合同", "三方协议"]), clauses: z.number() });

  it("第一次格式不对，带着原因重试一次后成功；不切换角色", async () => {
    const main = replies(['{"docType":"合同"}', '{"docType":"劳动合同","clauses":12}']);
    const alt = replies(["{}"]);
    const { ai } = setup({ main: main.model, alt: alt.model });
    expect(await ai.generateObject("extract", schema, { prompt: "测试" })).toEqual({
      docType: "劳动合同",
      clauses: 12,
    });
    expect(main.calls.n).toBe(2);
    expect(alt.calls.n).toBe(0);
  });

  it("连续两次格式不对抛 StructuredOutputError", async () => {
    const main = replies(["不是 JSON"]);
    const { ai } = setup({ main: main.model, alt: replies(["{}"]).model });
    await expect(ai.generateObject("extract", schema, { prompt: "测试" })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    expect(main.calls.n).toBe(2);
  });
});

describe("预算", () => {
  const now = Date.UTC(2026, 9, 30, 4); // 北京时间 10-30 12:00

  it("当天 token 用完时不调用模型，恢复时间是北京时间次日零点", async () => {
    const main = replies(["好"]);
    const { ai, usage } = setup({ main: main.model }, [role("main")], () => now);
    usage.record({
      ts: now - 3600_000,
      provider: "chatapi.example.com",
      role: "main",
      purpose: "plan",
      ok: true,
      requests: 1,
      inputTokens: limits.dailyTokens,
      outputTokens: 0,
      latencyMs: 1,
    });
    const err = await ai.generate("plan", { prompt: "测试" }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.reason).toBe("daily_tokens");
    expect(err.resetAt).toBe(Date.UTC(2026, 9, 30, 16));
    expect(main.calls.n).toBe(0);
  });

  it("前一天的用量不算进今天", async () => {
    const { ai, usage } = setup({ main: replies(["好"]).model }, [role("main")], () => now);
    usage.record({
      ts: Date.UTC(2026, 9, 29, 15),
      provider: "chatapi.example.com",
      role: "main",
      purpose: "plan",
      ok: true,
      requests: 1,
      inputTokens: limits.dailyTokens,
      outputTokens: 0,
      latencyMs: 1,
    });
    expect((await ai.generate("plan", { prompt: "测试" })).text).toBe("好");
  });

  it("5 小时请求次数到上限，恢复时间按最早一次请求算", async () => {
    const { ai, usage } = setup({ main: replies(["好"]).model }, [role("main")], () => now);
    const first = now - 3600_000;
    usage.record({
      ts: first,
      provider: "chatapi.example.com",
      role: "main",
      purpose: "plan",
      ok: true,
      requests: limits.requests5h,
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const err = await ai.generate("plan", { prompt: "测试" }).catch((e) => e);
    expect(err.reason).toBe("requests_5h");
    expect(err.resetAt).toBe(first + 5 * 3600_000);
  });

  it("北京时间零点切分", () => {
    expect(dayStartCN(Date.UTC(2026, 9, 30, 15, 59))).toBe(Date.UTC(2026, 9, 29, 16));
    expect(dayStartCN(Date.UTC(2026, 9, 30, 16, 0))).toBe(Date.UTC(2026, 9, 30, 16));
  });
});

// 模拟流里的两种块：文字片段，或者中途出错
type DeltaOrError =
  { type: "text-delta"; id: string; delta: string } | { type: "error"; error: unknown };

describe("流式", () => {
  const streaming = (deltas: string[], errorAfter?: number) =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            ...deltas.flatMap((d, i): DeltaOrError[] =>
              i === errorAfter
                ? [{ type: "error" as const, error: apiError(502) }]
                : [{ type: "text-delta" as const, id: "t", delta: d }],
            ),
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: stop,
              logprobs: undefined,
              usage: tokens(3, deltas.length),
            },
          ],
        }),
      }),
    });

  const collect = async (it: AsyncIterable<string>) => {
    let s = "";
    for await (const d of it) s += d;
    return s;
  };

  it("拼出全文并记账", async () => {
    const { ai, usage } = setup({ main: streaming(["试用", "期", "两个月"]) }, [role("main")]);
    const s = ai.stream("practice", { prompt: "测试" });
    expect(await collect(s.textStream)).toBe("试用期两个月");
    expect((await s.result).role).toBe("main");
    const rows = usage.summary(Date.UTC(2026, 9, 30, 4)) as { output: number }[];
    expect(rows[0].output).toBe(3);
  });

  it("还没输出就失败时切到下一个角色", async () => {
    const { ai } = setup({ alt: failing(500).model, main: streaming(["好"]) });
    // practice 先用 alt
    const s = ai.stream("practice", { prompt: "测试" });
    expect(await collect(s.textStream)).toBe("好");
    expect((await s.result).role).toBe("main");
  });

  it("已经输出内容后出错不切换，直接报错", async () => {
    const alt = replies(["不该用到"]);
    const { ai } = setup({ main: streaming(["前半", "后半"], 1), alt: alt.model }, [
      role("main"),
      role("alt"),
    ]);
    const s = ai.stream("plan", { prompt: "测试" });
    await expect(collect(s.textStream)).rejects.toBeTruthy();
    await expect(s.result).rejects.toBeTruthy();
    expect(alt.calls.n).toBe(0);
  });

  it("预算超限时流式也不调用", async () => {
    const now = Date.UTC(2026, 9, 30, 4);
    const { ai, usage } = setup({ main: streaming(["好"]) }, [role("main")], () => now);
    usage.record({
      ts: now,
      provider: "chatapi.example.com",
      role: "main",
      purpose: "plan",
      ok: true,
      requests: 1,
      inputTokens: limits.dailyTokens,
      outputTokens: 0,
      latencyMs: 1,
    });
    const s = ai.stream("plan", { prompt: "测试" });
    await expect(collect(s.textStream)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(s.result).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("AllModelsFailedError 带上最后一个错误", async () => {
    const { ai } = setup({ main: failing(500).model, alt: failing(500).model });
    const s = ai.stream("plan", { prompt: "测试" });
    const err = await collect(s.textStream).catch((e) => e);
    expect(err).toBeInstanceOf(AllModelsFailedError);
    expect(APICallError.isInstance(err.lastError)).toBe(true);
  });
});

describe("思考强度按步骤", () => {
  it("默认只有自检和报告开思考，环境变量可以单独改", async () => {
    const { effortFor } = await import("./config");
    const r = role("main");
    expect(effortFor("verify", r, {})).toBe("high");
    expect(effortFor("report", r, {})).toBe("medium");
    expect(effortFor("extract", r, {})).toBeUndefined();
    expect(effortFor("ocr", r, {})).toBeUndefined();
    expect(effortFor("extract", r, { REASONING_EXTRACT: "high" })).toBe("high");
    expect(effortFor("verify", r, { REASONING_VERIFY: "off" })).toBeUndefined();
  });
});

// 平台挂住的请求：一直不返回，直到被取消
function hanging() {
  const calls = { n: 0, aborted: 0 };
  const model = new MockLanguageModelV4({
    doGenerate: (opts) => {
      calls.n++;
      return new Promise((_, reject) => {
        opts.abortSignal?.addEventListener("abort", () => {
          calls.aborted++;
          reject(opts.abortSignal!.reason);
        });
      });
    },
  });
  return { model, calls };
}

// 第 n 次调用（从 0 开始）挂住，其余正常回复
function hangsOn(n: number, text: string) {
  const h = hanging();
  const r = replies([text]);
  const calls = { n: 0 };
  const model = new MockLanguageModelV4({
    doGenerate: (opts) => (calls.n++ === n ? h.model.doGenerate(opts) : r.model.doGenerate(opts)),
  });
  return { model, calls, hung: h.calls };
}

const NOW = Date.UTC(2026, 9, 30, 4);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("时限和对冲", () => {
  it("第一份过了 hedgeMs 没回，向复核模型再发一份；先回来的算数，挂住的那份被取消并记账", async () => {
    const main = hanging();
    const alt = replies(["好"]);
    const { ai, usage } = setup({ main: main.model, alt: alt.model });
    const r = await ai.generate("plan", { prompt: "测试", hedgeMs: 20 });
    expect(r.text).toBe("好");
    await tick();
    expect(main.calls.aborted).toBe(1);
    expect(usage.failures(NOW)).toEqual([
      expect.objectContaining({ role: "main", error: "HedgeCancelled", calls: 1 }),
    ]);
  });

  it("第一份在 hedgeMs 内回来，就不发第二份", async () => {
    const main = replies(["主"]);
    const alt = replies(["复核"]);
    const { ai } = setup({ main: main.model, alt: alt.model });
    expect((await ai.generate("plan", { prompt: "测试", hedgeMs: 200 })).text).toBe("主");
    expect(alt.calls.n).toBe(0);
  });

  it("只配了一个角色时，对冲的那份发给同一个角色", async () => {
    const main = hangsOn(0, "第二份");
    const { ai } = setup({ main: main.model }, [role("main")]);
    expect((await ai.generate("plan", { prompt: "测试", hedgeMs: 20 })).text).toBe("第二份");
    expect(main.calls.n).toBe(2);
  });

  it("结构化输出同样对冲", async () => {
    const main = hanging();
    const alt = replies(['{"n":3}']);
    const { ai } = setup({ main: main.model, alt: alt.model });
    const r = await ai.generateObject("rerank", z.object({ n: z.number() }), {
      prompt: "测试",
      hedgeMs: 20,
    });
    expect(r).toEqual({ n: 3 });
  });

  it("超过 timeoutMs 算供应商那边的失败，换下一个角色", async () => {
    const main = hanging();
    const alt = replies(["好"]);
    const { ai, usage } = setup({ main: main.model, alt: alt.model });
    expect((await ai.generate("plan", { prompt: "测试", timeoutMs: 20 })).text).toBe("好");
    const failed = usage.failures(NOW) as { role: string; error: string }[];
    expect(failed.map((x) => x.role)).toEqual(["main"]);
    expect(["TimeoutError", "AbortError"]).toContain(failed[0].error);
  });

  it("调用方自己取消时直接停，不换角色", async () => {
    const main = hanging();
    const alt = replies(["不该用到"]);
    const { ai } = setup({ main: main.model, alt: alt.model });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    await expect(
      ai.generate("plan", { prompt: "测试", abortSignal: ctl.signal, hedgeMs: 200 }),
    ).rejects.toBeDefined();
    expect(alt.calls.n).toBe(0);
  });

  it("两份都失败时报 AllModelsFailedError，不再往下试", async () => {
    const main = hanging();
    const alt = failing(503);
    const { ai } = setup({ main: main.model, alt: alt.model });
    await expect(
      ai.generate("plan", { prompt: "测试", hedgeMs: 20, timeoutMs: 60 }),
    ).rejects.toMatchObject({ name: "AllModelsFailedError", tried: ["main", "alt"] });
  });
});
