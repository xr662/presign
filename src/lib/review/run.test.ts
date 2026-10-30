// 审查流程编排测试：模型层是假的（按用途给固定回复，回复先过调用方的 schema），规则工具是真的
// （内存通道连 buildServer，库用不带向量的临时库）。只测编排：事件顺序、出处过滤、自检降级、
// 检索结论的依据限制、报告把关、出错和超限时的停止方式。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { StructuredOutputError } from "../ai/errors.ts";
import type { ReviewEvent } from "./events.ts";
import type { Facts } from "./facts.ts";
import { clauseNo, runReview } from "./run.ts";
import { SAMPLE_FACTS } from "./sample-facts.ts";
import { toolsFromClient, type Tools } from "./tools.ts";

const LABOR = readFileSync("data/samples/labor.md", "utf8");
let dir: string;
let tools: Tools;
let closeStore: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "run-"));
  execFileSync(process.execPath, [
    "scripts/corpus/build-db.ts",
    "--no-vectors",
    "--out",
    join(dir, "law.db"),
  ]);
  process.env.LAW_DB_PATH = join(dir, "law.db");
  const server = await import("../../../mcp/labor-law/server.ts");
  closeStore = server.closeStore;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.buildServer().connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  tools = toolsFromClient(client);
}, 60_000);

afterAll(async () => {
  await tools?.close();
  closeStore?.();
  rmSync(dir, { recursive: true, force: true });
});

type Reply = unknown | Error | ((prompt: string) => unknown);

/** 假模型层：按用途回复；回复先过调用方传的 schema，和真实接入层一样校验 */
function fakeAi(replies: Partial<Record<string, Reply>>, delayMs = 0) {
  const calls: string[] = [];
  const ai = {
    async generateObject<S extends z.ZodType>(
      purpose: string,
      schema: S,
      o: { prompt?: string; abortSignal?: AbortSignal },
    ): Promise<z.infer<S>> {
      calls.push(purpose);
      if (delayMs)
        await new Promise((r, j) => {
          const t = setTimeout(r, delayMs);
          o.abortSignal?.addEventListener("abort", () => {
            clearTimeout(t);
            j(o.abortSignal!.reason);
          });
        });
      const r = replies[purpose];
      if (r instanceof Error) throw r;
      const v = typeof r === "function" ? (r as (p: string) => unknown)(o.prompt ?? "") : r;
      return schema.parse(v);
    },
  };
  return { ai: ai as never, calls };
}

// 回复里引用的 ID 要从提示词里取（检查 ID、批注 ID 每次一样，但这样写不依赖编号细节）
const idsIn = (prompt: string, prefix: string) => [
  ...new Set([...prompt.matchAll(new RegExp(`\\[(${prefix}\\d+)\\]`, "g"))].map((m) => m[1])),
];
const allOk = (p: string) => ({
  results: idsIn(p, "c").map((id) => ({ id, check: "一致", ok: true })),
});
const plainReport = (p: string) => ({
  items: idsIn(p, "f").map((id) => ({
    id,
    conclusion: "这条约定无效。",
    revision: null,
    talkingPoint: null,
  })),
});

async function run(facts: Facts, replies: Partial<Record<string, Reply>>, opts = {}) {
  const events: ReviewEvent[] = [];
  const { ai, calls } = fakeAi({ extract: facts, verify: allOk, report: plainReport, ...replies });
  const result = await runReview({ text: LABOR }, { ai, tools }, (e) => events.push(e), opts);
  return { events, result, calls };
}

describe("审查流程", () => {
  it("劳动合同样例：事件按步骤推送，标准答案的结论都给出了，每条都有依据原文", async () => {
    const { events, result, calls } = await run(SAMPLE_FACTS.labor, {});
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("step");
    expect(types.at(-1)).toBe("done");
    expect(types.indexOf("plan")).toBeLessThan(types.indexOf("tool_call"));
    expect(calls.sort()).toEqual(["extract", "report", "verify"]);

    const got = result.findings.map((f) => `${f.rule} ${f.verdict}`);
    for (const want of [
      "R01 violation",
      "R05 ok",
      "R06 violation",
      "R07 ok",
      "R09 violation",
      "R11 ok",
      "R16 ok",
    ])
      expect(got).toContain(want);
    expect(result.findings.every((f) => f.basis.length > 0 && f.basis.every((b) => b.text))).toBe(
      true,
    );
    // 第三条的结论挂在原文上，界面点批注能回到这一段
    expect(result.findings.find((f) => f.rule === "R01")).toMatchObject({
      clause: "第三条",
      quote: "其中试用期 3 个月",
    });
    // 每条结论都有一个自检事件；只有不是 ok 的才写报告
    const verified = events.filter((e) => e.type === "verify").length;
    expect(verified).toBe(result.findings.length);
    const reported = events.filter((e) => e.type === "report").length;
    expect(reported).toBe(result.findings.filter((f) => f.verdict !== "ok").length);
    const done = events.at(-1) as Extract<ReviewEvent, { type: "done" }>;
    expect(Object.values(done.counts).reduce((a, b) => a + b, 0)).toBe(result.findings.length);
    expect(result.stopped).toBeNull();
  });

  it("引用的原文在合同里找不到的字段不拿去检查，检查记录里写明", async () => {
    const facts: Facts = {
      ...SAMPLE_FACTS.labor,
      socialInsurance: {
        waived: true,
        subsidy: 500,
        src: { clause: "第六条", quote: "双方约定不缴纳社会保险" },
      },
    };
    const { events, result } = await run(facts, {});
    expect(result.findings.find((f) => f.rule === "R13")).toBeUndefined();
    expect(
      events.some((e) => e.type === "step" && /1 项引用的原文在合同里找不到.*社保/.test(e.text)),
    ).toBe(true);
  });

  it("模型核对出字段和原文不一致：那次调用的结论改为需要确认，原因写进自检事件", async () => {
    const verify = (p: string) => ({
      results: idsIn(p, "c").map((id, i) => ({
        id,
        check: i === 0 ? "原文是 2 个月，字段写成 3 个月" : "一致",
        ok: i !== 0,
      })),
    });
    const { events, result } = await run(SAMPLE_FACTS.labor, { verify });
    // 第一次调用是试用期
    const r01 = result.findings.find((f) => f.rule === "R01")!;
    expect(r01.verdict).toBe("needs_review");
    const ev = events.find((e) => e.type === "verify" && e.findingId === r01.id);
    expect(ev).toMatchObject({ ok: false, verdict: "needs_review" });
    expect((ev as { reason: string }).reason).toContain("原文是 2 个月");
  });

  it("模型核对没有完成时不降级，检查记录里写明没核对完", async () => {
    const { events, result } = await run(SAMPLE_FACTS.labor, {
      verify: new StructuredOutputError(2),
    });
    expect(result.findings.find((f) => f.rule === "R01")!.verdict).toBe("violation");
    expect(
      events.some(
        (e) => e.type === "step" && e.state === "failed" && /核对抽取字段没有完成/.test(e.text),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "step" && /没有核对完/.test(e.text))).toBe(true);
  });

  it("规则覆盖不到的条款：依据只能是这一条自己的检索结果，候选以外的 ID 被拦下；没有依据就不出批注", async () => {
    const facts: Facts = {
      ...SAMPLE_FACTS.labor,
      others: [
        {
          concern: "社保费从工资里扣",
          src: { clause: "第六条", quote: "个人应缴部分由甲方从乙方工资中代扣代缴" },
        },
        {
          concern: "合同份数",
          src: { clause: "第十二条", quote: "本合同一式两份，甲乙双方各执一份" },
        },
      ],
    };
    let pools: string[] = [];
    const execute = (p: string) => {
      // 从提示词里取 o1 的第一个候选，o2 给一个检索结果里没有的 ID
      pools = [...p.matchAll(/\n {2}\[([a-z0-9-]+)\]/g)].map((m) => m[1]);
      const explain = {
        conclusion: "可以和单位确认代扣的项目。",
        revision: null,
        talkingPoint: null,
      };
      return {
        items: [
          {
            id: "o1",
            verdict: "advice",
            title: "代扣个人应缴部分符合规定",
            basis: [{ id: pools[0], why: "x" }],
            steps: ["a"],
            factsNeeded: [],
            ...explain,
          },
          {
            id: "o2",
            verdict: "advice",
            title: "x",
            basis: [],
            steps: [],
            factsNeeded: [],
            ...explain,
          },
        ],
      };
    };
    const { events, result, calls } = await run(facts, {
      rewrite: { queries: ["用人单位代扣代缴社会保险费"] },
      execute,
    });
    const model = result.findings.filter((f) => f.source === "model");
    expect(model).toHaveLength(1);
    expect(model[0].basis[0].id).toBe(pools[0]);
    expect(model[0].basis[0].text.length).toBeGreaterThan(0);
    expect(
      events.some((e) => e.type === "step" && /第十二条：没有找到能作为依据的条文/.test(e.text)),
    ).toBe(true);
    // 判断结论的说明在判断时一起写好，有自检事件和报告事件，报告步骤只写规则结论
    expect(events.some((e) => e.type === "verify" && e.findingId === model[0].id)).toBe(true);
    expect(events.find((e) => e.type === "report" && e.findingId === model[0].id)).toMatchObject({
      conclusion: "可以和单位确认代扣的项目。",
    });
    expect(calls.filter((c) => c === "report")).toHaveLength(1);
  });

  it("报告里出现材料里没有的数字，这条不推报告；修改稿的 before 不在合同里就不显示修改稿", async () => {
    const report = (p: string) => ({
      items: idsIn(p, "f").map((id, i) => ({
        id,
        conclusion: i === 0 ? "你可以要求赔偿 99999 元。" : "这条约定无效。",
        revision: {
          before: i === 1 ? "合同里没有的一句话" : "其中试用期 3 个月",
          after: "删除本条",
        },
        talkingPoint: null,
      })),
    });
    const { events } = await run(SAMPLE_FACTS.labor, { report });
    const reports = events.filter(
      (e): e is Extract<ReviewEvent, { type: "report" }> => e.type === "report",
    );
    expect(reports.some((r) => r.conclusion.includes("99999"))).toBe(false);
    expect(
      reports.find((r) => r.conclusion === "这条约定无效。" && r.revision === null),
    ).toBeTruthy();
    expect(events.some((e) => e.type === "step" && /出现材料里没有的数字/.test(e.text))).toBe(true);
  });

  it("抽取失败：推一个 error 再推 done，结果里写明停在哪", async () => {
    const { events, result } = await run(SAMPLE_FACTS.labor, {
      extract: new StructuredOutputError(2),
    });
    expect(events.map((e) => e.type).slice(-2)).toEqual(["error", "done"]);
    expect(result.findings).toEqual([]);
    expect(result.stopped).toMatch(/extract/);
  });

  it("模型调用到上限就停，已出的结论保留", async () => {
    const { events, result } = await run(SAMPLE_FACTS.labor, {}, { maxModelCalls: 1 });
    const err = events.find((e) => e.type === "error") as { code: string } | undefined;
    expect(err?.code).toBe("call_budget");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("超过整次时限就停在当前步骤", async () => {
    const events: ReviewEvent[] = [];
    const { ai } = fakeAi({ extract: SAMPLE_FACTS.labor }, 200);
    const r = await runReview({ text: LABOR }, { ai, tools }, (e) => events.push(e), {
      deadlineMs: 50,
    });
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "deadline" });
    expect(r.stopped).toMatch(/超过/);
  });
});

describe("条款编号", () => {
  it.each([
    ["五、报到时请携带身份证", "五"],
    ["第十一条 合同的变更", "第十一条"],
    ["3. 工作时间", "3"],
    ["第三条", "第三条"],
    ["乙方须对甲方经营信息保密，离职后 3 年内", null],
    [null, null],
  ])("%s → %s", (raw, want) => {
    expect(clauseNo(raw)).toBe(want);
  });
});
