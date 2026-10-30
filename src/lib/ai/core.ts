// 模型接入层：按用途选角色、失败切下一个、结构化输出校验、用量记账、预算检查。
// 审查流程、识别、谈判练习都只通过这里调模型，不直接 import 供应商的包。
//
// 切换规则：供应商那边的失败（HTTP 错误、网络错误、重试用尽）换下一个角色再试；
// 我们自己的错误（预算超限、输出格式不对）不换，前者直接报给用户，后者由 generateObject 重试一次。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  Output,
  RetryError,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import {
  chainFor,
  providerKey,
  type Limits,
  type Purpose,
  type Role,
  type RoleConfig,
} from "./config";
import { AllModelsFailedError, NoModelAvailableError, StructuredOutputError } from "./errors";
import type { UsageStore } from "./usage";

export type CallOptions = {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  stopWhen?: StopCondition<ToolSet>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

export type AiDeps = {
  roles: RoleConfig[];
  limits: Limits;
  usage: UsageStore;
  // 测试时换成模拟模型
  modelFor?: (r: RoleConfig) => LanguageModel;
  now?: () => number;
  // 同一个角色内 SDK 自带的重试次数；用尽后才换角色
  maxRetries?: number;
};

type Attempt<T> = { value: T; usage?: LanguageModelUsage; requests?: number };

function defaultModel(r: RoleConfig): LanguageModel {
  return createOpenAICompatible({
    name: r.role,
    baseURL: r.baseURL,
    apiKey: r.apiKey,
    includeUsage: true,
    // 平台只认 json_schema；json_object 模式下模型不按结构输出（10-30 实测）
    supportsStructuredOutputs: true,
    transformRequestBody: r.reasoningEffort
      ? (body) => ({ ...body, reasoning_effort: r.reasoningEffort })
      : undefined,
  })(r.model);
}

const isProviderFailure = (e: unknown) =>
  APICallError.isInstance(e) || RetryError.isInstance(e) || e instanceof TypeError;

const errName = (e: unknown) => {
  if (APICallError.isInstance(e)) return `APICallError ${e.statusCode ?? ""}`.trim();
  return e instanceof Error ? e.name : "Error";
};

// SDK 的 prompt 和 messages 只能给一个
function promptOf(o: CallOptions) {
  return o.messages ? { messages: o.messages } : { prompt: o.prompt ?? "" };
}

export function createAi(deps: AiDeps) {
  const now = deps.now ?? Date.now;
  const maxRetries = deps.maxRetries ?? 1;
  const cache = new Map<Role, LanguageModel>();
  const modelFor = (r: RoleConfig) => {
    if (deps.modelFor) return deps.modelFor(r);
    if (!cache.has(r.role)) cache.set(r.role, defaultModel(r));
    return cache.get(r.role)!;
  };

  const record = (
    r: RoleConfig,
    purpose: Purpose,
    t0: number,
    ok: boolean,
    u?: LanguageModelUsage,
    requests = 1,
    error?: unknown,
  ) =>
    deps.usage.record({
      ts: t0,
      provider: providerKey(r),
      role: r.role,
      purpose,
      ok,
      requests,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      latencyMs: now() - t0,
      error: error === undefined ? undefined : errName(error),
    });

  /** 按角色顺序尝试；每次尝试前查预算，结束后记账 */
  async function attempt<T>(
    purpose: Purpose,
    fn: (model: LanguageModel, r: RoleConfig) => Promise<Attempt<T>>,
  ): Promise<T> {
    const chain = chainFor(purpose, deps.roles);
    if (chain.length === 0) throw new NoModelAvailableError();
    const tried: string[] = [];
    let last: unknown;
    for (const r of chain) {
      deps.usage.check(providerKey(r), deps.limits, now());
      const t0 = now();
      try {
        const res = await fn(modelFor(r), r);
        record(r, purpose, t0, true, res.usage, res.requests);
        return res.value;
      } catch (e) {
        // 格式不对的输出也花了 token，照记
        const u = NoObjectGeneratedError.isInstance(e) ? e.usage : undefined;
        record(r, purpose, t0, false, u, 1, e);
        if (!isProviderFailure(e)) throw e;
        tried.push(r.role);
        last = e;
      }
    }
    throw new AllModelsFailedError(tried, last);
  }

  return {
    roles: deps.roles.map((r) => r.role),

    /** 普通生成，可带工具 */
    generate(purpose: Purpose, o: CallOptions) {
      return attempt(purpose, async (model) => {
        const r = await generateText({
          model,
          maxRetries,
          system: o.system,
          ...promptOf(o),
          tools: o.tools,
          stopWhen: o.stopWhen,
          maxOutputTokens: o.maxOutputTokens,
          abortSignal: o.abortSignal,
        });
        return { value: r, usage: r.usage, requests: Math.max(1, r.steps.length) };
      });
    },

    /** 结构化输出：按 zod schema 校验，不合格带着原因重试一次，仍不合格抛 StructuredOutputError */
    async generateObject<S extends z.ZodType>(
      purpose: Purpose,
      schema: S,
      o: { system?: string; prompt: string; abortSignal?: AbortSignal },
    ): Promise<z.infer<S>> {
      let note = "";
      for (let i = 0; i < 2; i++) {
        try {
          return await attempt(purpose, async (model) => {
            const r = await generateText({
              model,
              maxRetries,
              system: o.system,
              prompt: o.prompt + note,
              output: Output.object({ schema }),
              abortSignal: o.abortSignal,
            });
            return { value: r.output as z.infer<S>, usage: r.usage };
          });
        } catch (e) {
          if (!NoObjectGeneratedError.isInstance(e)) throw e;
          note = `\n\n上一次的输出不符合要求的格式（${e.message.slice(0, 120)}）。只输出符合格式的 JSON，不要加说明。`;
        }
      }
      throw new StructuredOutputError(2);
    },

    /**
     * 流式输出。还没吐出第一个字之前出错，换下一个角色重来；已经吐出内容后出错就直接报错，
     * 不然用户会看到两段拼在一起的回答。
     */
    stream(purpose: Purpose, o: CallOptions) {
      let done!: (v: { text: string; role: Role; usage: LanguageModelUsage }) => void;
      let fail!: (e: unknown) => void;
      const result = new Promise<{ text: string; role: Role; usage: LanguageModelUsage }>(
        (res, rej) => {
          done = res;
          fail = rej;
        },
      );
      // 调用方只读 textStream 不等 result 时，避免未处理的 rejection
      result.catch(() => {});

      async function* run(): AsyncGenerator<string> {
        const chain = chainFor(purpose, deps.roles);
        if (chain.length === 0) {
          const e = new NoModelAvailableError();
          fail(e);
          throw e;
        }
        const tried: string[] = [];
        let last: unknown;
        for (const r of chain) {
          try {
            deps.usage.check(providerKey(r), deps.limits, now());
          } catch (e) {
            fail(e);
            throw e;
          }
          const t0 = now();
          let emitted = false;
          let text = "";
          try {
            const s = streamText({
              model: modelFor(r),
              maxRetries,
              system: o.system,
              ...promptOf(o),
              tools: o.tools,
              stopWhen: o.stopWhen,
              maxOutputTokens: o.maxOutputTokens,
              abortSignal: o.abortSignal,
              onError: () => {},
            });
            let usage: LanguageModelUsage | undefined;
            for await (const part of s.fullStream) {
              if (part.type === "error") throw part.error;
              if (part.type === "text-delta") {
                emitted = true;
                text += part.text;
                yield part.text;
              }
              if (part.type === "finish") usage = part.totalUsage;
            }
            const steps = await s.steps;
            record(r, purpose, t0, true, usage, Math.max(1, steps.length));
            done({ text, role: r.role, usage: usage! });
            return;
          } catch (e) {
            record(r, purpose, t0, false, undefined, 1, e);
            if (emitted || !isProviderFailure(e)) {
              fail(e);
              throw e;
            }
            tried.push(r.role);
            last = e;
          }
        }
        const e = new AllModelsFailedError(tried, last);
        fail(e);
        throw e;
      }

      return { textStream: run(), result };
    },
  };
}

export type Ai = ReturnType<typeof createAi>;
