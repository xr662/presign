// 法条检索：改写 → 混合检索 → 重排（项目方案第 6 节）。
// 审查流程里规则覆盖不到的条款走这里；规则能判的条款，依据由规则直接给出，不经过检索。
//
// 为什么要改写：口语和法条用词不同（押金／收取财物，调岗／变更劳动合同约定的内容），
// T03 抽查里这类查询全文检索查不到，向量也只补回一部分。改写后的查询和原句一起检索，原句兜底。
// 为什么要重排：RRF 只看名次，字面相似但管别的事的条文会排得很靠前；让模型读原文再排一次。
//
// 改写或重排失败都不中断检索：改写失败只用原句，重排失败用 RRF 的顺序，原因写进 degraded，
// 检查记录里照实显示。只有调用方主动取消（abortSignal）时才抛错。
//
// 相对导入写 .ts 后缀，评测脚本（scripts/eval/retrieval.ts）用 Node 直接运行这个文件。

import { z } from "zod";
import { RERANK_PROMPT, REWRITE_PROMPT } from "../../prompts/retrieval.ts";
import type { Ai } from "../ai/core.ts";
import { aiErrorCode } from "../ai/errors.ts";

export type Candidate = { id: string; kind: string; title: string; text: string };
/** 一组查询一起检索，返回合并后的前 k 条。线上走 MCP 的 search_law，评测直接调 hybridSearch */
export type SearchFn = (queries: string[], k: number) => Promise<Candidate[]>;

export type RetrieveInput = {
  /** 条款原文，或用户的提问 */
  text: string;
  /** 文书类型。三方协议、录用通知要查民法典的合同编，告诉改写步骤能少走偏 */
  docKind?: string;
  /** 已经写好的法条用语查询（比如抽取步骤顺带给出），给了就跳过改写，省一次模型调用 */
  queries?: string[];
};

export type RetrieveOptions = {
  rewrite?: boolean;
  rerank?: boolean;
  /** 送去重排的候选数。20 条原文约 4~6K tokens */
  pool?: number;
  topK?: number;
  abortSignal?: AbortSignal;
};

export type Degraded = { step: "rewrite" | "rerank"; reason: string };

export type RetrieveResult = {
  /** 实际检索用的查询，第一个是原句 */
  queries: string[];
  /** RRF 合并后的候选，按 RRF 顺序 */
  pool: Candidate[];
  /** 最终结果：重排后的顺序；没重排就是 RRF 前 topK */
  hits: Candidate[];
  degraded: Degraded[];
  ms: { rewrite: number; search: number; rerank: number; total: number };
};

const REWRITE_SCHEMA = z.object({ queries: z.array(z.string()).min(1).max(3) });

// 时限和对冲（见 src/lib/ai/core.ts 的 attempt）。10-30 开发集上成功的改写中位数约 3.3 秒、
// 重排约 4.5 秒，但平台时快时慢，同一天下午成功的调用平均 7~10 秒，还有请求挂住不返回。
// 对冲点取在正常耗时的一倍半左右：挂住的请求只多等这么久；时限是每一份请求的上限，到了算失败。
// 两份都失败就降级：改写失败只用原句，重排失败用 RRF 顺序
const REWRITE_CALL = { hedgeMs: 5_000, timeoutMs: 15_000 };
const RERANK_CALL = { hedgeMs: 8_000, timeoutMs: 20_000 };

// 重排时每条候选只给前 300 字，控制输入长度（重排耗时随输入增长）。实测数字见评测报告
const CANDIDATE_CHARS = 300;

function reasonOf(e: unknown): string {
  const code = aiErrorCode(e);
  if (code === "budget_exceeded") return "用量到上限";
  if (code === "no_model") return "没有可用的模型";
  if (code === "bad_output") return "模型没有按格式输出";
  if (code === "all_failed") return "模型接口调用失败";
  return e instanceof Error ? e.name : "未知错误";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function rewritePrompt(input: RetrieveInput): string {
  const kind = input.docKind ? `文书类型：${input.docKind}\n` : "";
  return `${REWRITE_PROMPT.text}\n\n${kind}<<<\n${input.text}\n>>>`;
}

export function rerankPrompt(input: RetrieveInput, pool: Candidate[]): string {
  const list = pool
    .map((c) => `[${c.id}] ${c.title}\n${clip(c.text.replace(/\s+/g, " "), CANDIDATE_CHARS)}`)
    .join("\n\n");
  const kind = input.docKind ? `文书类型：${input.docKind}\n` : "";
  return `${RERANK_PROMPT.text}\n\n${kind}条款或提问：\n<<<\n${input.text}\n>>>\n\n候选条文：\n${list}`;
}

export async function retrieve(
  input: RetrieveInput,
  deps: { ai: Pick<Ai, "generateObject">; search: SearchFn },
  { rewrite = true, rerank = true, pool = 20, topK = 8, abortSignal }: RetrieveOptions = {},
): Promise<RetrieveResult> {
  const t0 = performance.now();
  const degraded: Degraded[] = [];
  const rethrowIfAborted = (e: unknown) => {
    if (abortSignal?.aborted) throw e;
  };

  // 1. 改写
  let extra = input.queries ?? [];
  const tr = performance.now();
  if (rewrite && extra.length === 0) {
    try {
      const r = await deps.ai.generateObject("rewrite", REWRITE_SCHEMA, {
        prompt: rewritePrompt(input),
        abortSignal,
        ...REWRITE_CALL,
      });
      extra = r.queries;
    } catch (e) {
      rethrowIfAborted(e);
      degraded.push({ step: "rewrite", reason: reasonOf(e) });
    }
  }
  const rewriteMs = performance.now() - tr;
  const queries = [...new Set([input.text, ...extra].map((q) => q.trim()).filter(Boolean))];

  // 2. 检索
  const ts = performance.now();
  const candidates = await deps.search(queries, pool);
  const searchMs = performance.now() - ts;

  // 3. 重排
  let hits = candidates.slice(0, topK);
  const tk = performance.now();
  if (rerank && candidates.length > 0) {
    const ids = candidates.map((c) => c.id) as [string, ...string[]];
    try {
      // ID 用枚举限定：模型只能从候选里选，编不出库里没有的条文。
      // 条数不在 schema 里限定：多给一两条就整次作废重来不划算，多的在下面截掉
      const r = await deps.ai.generateObject("rerank", z.object({ ids: z.array(z.enum(ids)) }), {
        prompt: rerankPrompt(input, candidates),
        abortSignal,
        ...RERANK_CALL,
      });
      // 枚举校验之外再按候选过滤一遍：换了供应商、结构化输出不严格时也不会混进候选以外的 ID
      const byId = new Map(candidates.map((c) => [c.id, c]));
      hits = [...new Set(r.ids)].flatMap((id) => byId.get(id) ?? []).slice(0, topK);
    } catch (e) {
      rethrowIfAborted(e);
      degraded.push({ step: "rerank", reason: reasonOf(e) });
    }
  }
  const rerankMs = performance.now() - tk;

  return {
    queries,
    pool: candidates,
    hits,
    degraded,
    ms: {
      rewrite: Math.round(rewriteMs),
      search: Math.round(searchMs),
      rerank: Math.round(rerankMs),
      total: Math.round(performance.now() - t0),
    },
  };
}
