// 检索流程测试：模型层换成假的，检索换成固定名单，只测编排逻辑。
// 覆盖：原句总在第一个、改写失败只用原句、已有查询跳过改写、重排只认候选 ID、重排失败用 RRF 顺序、取消时抛错。
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { StructuredOutputError } from "../ai/errors.ts";
import {
  rerankPrompt,
  retrieve,
  rewritePrompt,
  type Candidate,
  type SearchFn,
} from "./retrieve.ts";

const doc = (id: string): Candidate => ({ id, kind: "article", title: id, text: `${id} 的原文` });
const POOL = ["ldhtf-9", "ldhtf-84", "ldhtf-25", "ldhtf-19"].map(doc);

type Call = { purpose: string; prompt?: string; schema: z.ZodType };

/** 假模型层：按用途给回复，回复先过一遍调用方传来的 schema，和真实接入层一样校验 */
function fakeAi(replies: Partial<Record<string, unknown | Error>>) {
  const calls: Call[] = [];
  const ai = {
    async generateObject<S extends z.ZodType>(
      purpose: string,
      schema: S,
      o: { prompt?: string },
    ): Promise<z.infer<S>> {
      calls.push({ purpose, prompt: o.prompt, schema });
      const r = replies[purpose];
      if (r instanceof Error) throw r;
      return schema.parse(r);
    },
  };
  return { ai: ai as never, calls };
}

function fakeSearch(pool = POOL) {
  const seen: string[][] = [];
  const search: SearchFn = async (qs, k) => {
    seen.push(qs);
    return pool.slice(0, k);
  };
  return { search, seen };
}

describe("检索流程", () => {
  it("改写的查询排在原句后面一起检索，重复的去掉", async () => {
    const { ai } = fakeAi({
      rewrite: { queries: ["用人单位以担保名义收取财物", "入职交押金"] },
      rerank: { ids: ["ldhtf-9"] },
    });
    const s = fakeSearch();
    const r = await retrieve({ text: "入职交押金" }, { ai, search: s.search });
    expect(s.seen[0]).toEqual(["入职交押金", "用人单位以担保名义收取财物"]);
    expect(r.queries).toEqual(s.seen[0]);
    expect(r.degraded).toEqual([]);
  });

  it("改写失败时只用原句检索，记下降级原因", async () => {
    const { ai } = fakeAi({ rewrite: new StructuredOutputError(2), rerank: { ids: [] } });
    const s = fakeSearch();
    const r = await retrieve({ text: "入职交押金" }, { ai, search: s.search });
    expect(s.seen[0]).toEqual(["入职交押金"]);
    expect(r.degraded).toEqual([{ step: "rewrite", reason: "模型没有按格式输出" }]);
  });

  it("调用方已经给了查询，就不再调模型改写", async () => {
    const { ai, calls } = fakeAi({ rerank: { ids: ["ldhtf-9"] } });
    const s = fakeSearch();
    await retrieve({ text: "入职交押金", queries: ["用人单位收取财物"] }, { ai, search: s.search });
    expect(calls.map((c) => c.purpose)).toEqual(["rerank"]);
    expect(s.seen[0]).toEqual(["入职交押金", "用人单位收取财物"]);
  });

  it("重排结果按模型给的顺序，去重，最多 topK 条", async () => {
    const { ai } = fakeAi({
      rewrite: { queries: ["q"] },
      rerank: { ids: ["ldhtf-84", "ldhtf-9", "ldhtf-84"] },
    });
    const r = await retrieve({ text: "x" }, { ai, search: fakeSearch().search }, { topK: 2 });
    expect(r.hits.map((h) => h.id)).toEqual(["ldhtf-84", "ldhtf-9"]);
    expect(r.pool).toHaveLength(4);
  });

  it("重排的 schema 只接受候选里的 ID：模型编出库外的 ID 会被校验拒绝", async () => {
    const { ai, calls } = fakeAi({ rewrite: { queries: ["q"] }, rerank: { ids: ["ldhtf-9"] } });
    await retrieve({ text: "x" }, { ai, search: fakeSearch().search });
    const schema = calls.find((c) => c.purpose === "rerank")!.schema;
    expect(schema.safeParse({ ids: ["ldhtf-9"] }).success).toBe(true);
    expect(schema.safeParse({ ids: ["ldhtf-999"] }).success).toBe(false);
  });

  it("模型认为都不相关时返回空结果，不拿 RRF 的顺序凑数", async () => {
    const { ai } = fakeAi({ rewrite: { queries: ["q"] }, rerank: { ids: [] } });
    const r = await retrieve({ text: "x" }, { ai, search: fakeSearch().search });
    expect(r.hits).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it("重排失败时用 RRF 的顺序", async () => {
    const err = Object.assign(new Error("x"), { code: "all_failed" });
    const { ai } = fakeAi({ rewrite: { queries: ["q"] }, rerank: err });
    const r = await retrieve({ text: "x" }, { ai, search: fakeSearch().search }, { topK: 3 });
    expect(r.hits.map((h) => h.id)).toEqual(["ldhtf-9", "ldhtf-84", "ldhtf-25"]);
    expect(r.degraded).toEqual([{ step: "rerank", reason: "模型接口调用失败" }]);
  });

  it("没有候选时不调重排", async () => {
    const { ai, calls } = fakeAi({ rewrite: { queries: ["q"] } });
    const r = await retrieve({ text: "x" }, { ai, search: fakeSearch([]).search });
    expect(calls.map((c) => c.purpose)).toEqual(["rewrite"]);
    expect(r.hits).toEqual([]);
  });

  it("调用方取消时抛错，不降级继续", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { ai } = fakeAi({ rewrite: new DOMException("取消", "AbortError") });
    await expect(
      retrieve({ text: "x" }, { ai, search: fakeSearch().search }, { abortSignal: ctl.signal }),
    ).rejects.toThrow("取消");
  });
});

describe("提示词", () => {
  it("条款放在分隔符里，文书类型写在前面", () => {
    const p = rewritePrompt({ text: "违约金 5000 元", docKind: "三方协议" });
    expect(p).toContain("文书类型：三方协议\n<<<\n违约金 5000 元\n>>>");
  });

  it("重排的候选带 ID，原文超过 300 字截断", () => {
    const long = { ...doc("ldhtf-41"), text: "裁".repeat(400) };
    const p = rerankPrompt({ text: "裁员" }, [doc("ldhtf-9"), long]);
    expect(p).toContain("[ldhtf-9] ldhtf-9\nldhtf-9 的原文");
    expect(p).toContain(`${"裁".repeat(300)}…`);
    expect(p).not.toContain("裁".repeat(301));
  });
});
