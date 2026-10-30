// 模型接入层：按用途选角色、失败切下一个、结构化输出校验、用量记账、预算检查。
// 审查流程、识别、谈判练习都只通过这里调模型，不直接 import 供应商的包。
//
// 切换规则：供应商那边的失败（HTTP 错误、网络错误、重试用尽）换下一个角色再试；
// 我们自己的错误（预算超限、输出格式不对）不换，前者直接报给用户，后者由 generateObject 重试一次。
//
// 相对导入写 .ts 后缀：评测脚本（scripts/eval/）用 Node 直接运行这几个文件，测的是网站用的同一套代码。

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
  effortFor,
  providerKey,
  type Limits,
  type Purpose,
  type Role,
  type RoleConfig,
} from "./config.ts";
import { AllModelsFailedError, NoModelAvailableError, StructuredOutputError } from "./errors.ts";
import type { UsageStore } from "./usage.ts";

export type CallOptions = {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  stopWhen?: StopCondition<ToolSet>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  // 单个角色一次尝试的时限。超时算供应商那边的失败，换下一个角色。
  // 10-30 检索评测里有请求挂了 20 多秒才报错，不设时限一次检查会被一个请求拖住
  timeoutMs?: number;
  // 对冲：第一次尝试过了这么久还没返回，就向下一个角色再发一份同样的请求，先成功的算数（见 attempt）
  hedgeMs?: number;
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

function defaultModel(r: RoleConfig, effort: string | undefined): LanguageModel {
  return createOpenAICompatible({
    name: r.role,
    baseURL: r.baseURL,
    apiKey: r.apiKey,
    includeUsage: true,
    // 平台只认 json_schema；json_object 模式下模型不按结构输出（10-30 实测）
    supportsStructuredOutputs: true,
    transformRequestBody: effort ? (body) => ({ ...body, reasoning_effort: effort }) : undefined,
  })(r.model);
}

// SDK 的 timeout 到点时中止请求。多数时候抛 TimeoutError，有时（读响应体的阶段被中止）抛 AbortError，
// 10-30 评测里两种都见到了。调用方自己取消的情况在 attempt 里先排除，剩下的中止都是时限到了
const isTimeout = (e: unknown) => {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
};

// 对冲请求里输掉的那一份被取消时记的错误类型
const HEDGE_CANCELLED = Object.assign(new Error("对冲请求：另一份先返回，这份取消"), {
  name: "HedgeCancelled",
});

/** p 在 ms 毫秒内有结果（成功或失败）就返回 true */
function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(t);
      resolve(true);
    };
    p.then(done, done);
  });
}

const isProviderFailure = (e: unknown) =>
  APICallError.isInstance(e) || RetryError.isInstance(e) || e instanceof TypeError || isTimeout(e);

const errName = (e: unknown): string => {
  if (APICallError.isInstance(e)) return `APICallError ${e.statusCode ?? ""}`.trim();
  // 重试用尽时只看外层看不出原因，记最后一次的状态码（10-30 评测里连续几分钟全是 RetryError）
  if (RetryError.isInstance(e)) return `RetryError(${errName(e.lastError)})`;
  return e instanceof Error ? e.name : "Error";
};

// SDK 的 prompt 和 messages 只能给一个
function promptOf(o: CallOptions) {
  return o.messages ? { messages: o.messages } : { prompt: o.prompt ?? "" };
}

export function createAi(deps: AiDeps) {
  const now = deps.now ?? Date.now;
  const maxRetries = deps.maxRetries ?? 1;
  // 同一个角色按思考强度分别缓存一个模型实例
  const cache = new Map<string, LanguageModel>();
  const modelFor = (r: RoleConfig, purpose: Purpose) => {
    if (deps.modelFor) return deps.modelFor(r);
    const effort = effortFor(purpose, r);
    const key = `${r.role}:${effort ?? "off"}`;
    if (!cache.has(key)) cache.set(key, defaultModel(r, effort));
    return cache.get(key)!;
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

  /**
   * 按角色顺序尝试；每次尝试前查预算，结束后记账。
   *
   * hedgeMs（对冲）：第一次尝试过了 hedgeMs 还没有结果，就向下一个角色（只配了一个角色时就是它自己）
   * 再发一份同样的请求，先成功的那份算数，另一份取消。为什么：平台偶尔有请求挂住不返回
   * （10-30 实测，5 个只要回一个字的请求里有 1 个 60 秒没回），等时限到了再重试要多等整个时限，
   * 对冲只多等 hedgeMs。代价是慢的那部分请求会多发一份，取消的那份也按 1 次请求记账，平台按发出的请求计数。
   */
  async function attempt<T>(
    purpose: Purpose,
    fn: (model: LanguageModel, r: RoleConfig, signal: AbortSignal) => Promise<Attempt<T>>,
    { signal, hedgeMs }: { signal?: AbortSignal; hedgeMs?: number } = {},
  ): Promise<T> {
    const chain = chainFor(purpose, deps.roles);
    if (chain.length === 0) throw new NoModelAvailableError();
    const tried: string[] = [];
    let last: unknown;

    // 发一份请求。每份有自己的 AbortController，对冲输掉时只取消这一份
    const start = (r: RoleConfig) => {
      deps.usage.check(providerKey(r), deps.limits, now());
      const ctl = new AbortController();
      const t0 = now();
      const s = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal;
      const promise = fn(modelFor(r, purpose), r, s).then(
        (res) => {
          record(r, purpose, t0, true, res.usage, res.requests);
          return res.value;
        },
        (e: unknown) => {
          // 格式不对的输出也花了 token，照记
          const u = NoObjectGeneratedError.isInstance(e) ? e.usage : undefined;
          const lost = ctl.signal.aborted && !signal?.aborted;
          record(r, purpose, t0, false, u, 1, lost ? HEDGE_CANCELLED : e);
          throw e;
        },
      );
      return { role: r, ctl, promise };
    };

    let i = 0;
    while (i < chain.length) {
      const running = [start(chain[i])];
      if (hedgeMs && i === 0 && !(await settlesWithin(running[0].promise, hedgeMs))) {
        try {
          running.push(start(chain[1] ?? chain[0]));
        } catch {
          // 对冲的那份过不了预算检查就不发，只等第一份
        }
      }
      try {
        const value = await Promise.any(running.map((x) => x.promise));
        for (const x of running) x.ctl.abort();
        return value;
      } catch (agg) {
        const errors = (agg as AggregateError).errors;
        // 调用方自己取消的（包括它自己设的时限），或者不是供应商那边的问题（格式不对等），不换角色，直接停
        const fatal = errors.find((e) => signal?.aborted || !isProviderFailure(e));
        if (fatal !== undefined) throw fatal;
        for (const x of running) tried.push(x.role.role);
        last = errors.at(-1);
        // 对冲用掉了下一个角色，就从再下一个接着试
        i += running.length > 1 && running[1].role !== chain[i] ? 2 : 1;
      }
    }
    throw new AllModelsFailedError(tried, last);
  }

  return {
    roles: deps.roles.map((r) => r.role),

    /** 普通生成，可带工具 */
    generate(purpose: Purpose, o: CallOptions) {
      return attempt(
        purpose,
        async (model, _r, signal) => {
          const r = await generateText({
            model,
            maxRetries,
            system: o.system,
            ...promptOf(o),
            tools: o.tools,
            stopWhen: o.stopWhen,
            maxOutputTokens: o.maxOutputTokens,
            abortSignal: signal,
            timeout: o.timeoutMs,
          });
          return { value: r, usage: r.usage, requests: Math.max(1, r.steps.length) };
        },
        { signal: o.abortSignal, hedgeMs: o.hedgeMs },
      );
    },

    /** 结构化输出：按 zod schema 校验，不合格带着原因重试一次，仍不合格抛 StructuredOutputError */
    async generateObject<S extends z.ZodType>(
      purpose: Purpose,
      schema: S,
      o: Pick<
        CallOptions,
        "system" | "prompt" | "messages" | "abortSignal" | "timeoutMs" | "hedgeMs"
      >,
    ): Promise<z.infer<S>> {
      let note = "";
      for (let i = 0; i < 2; i++) {
        try {
          return await attempt(
            purpose,
            async (model, _r, signal) => {
              const r = await generateText({
                model,
                maxRetries,
                system: o.system,
                // 重试时把上次的格式问题附在后面；带图片的请求追加一条文字消息
                ...(o.messages
                  ? {
                      messages: note
                        ? [...o.messages, { role: "user" as const, content: note }]
                        : o.messages,
                    }
                  : { prompt: (o.prompt ?? "") + note }),
                output: Output.object({ schema }),
                abortSignal: signal,
                timeout: o.timeoutMs,
              });
              return { value: r.output as z.infer<S>, usage: r.usage };
            },
            { signal: o.abortSignal, hedgeMs: o.hedgeMs },
          );
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
              model: modelFor(r, purpose),
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
            if (emitted || o.abortSignal?.aborted || !isProviderFailure(e)) {
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
