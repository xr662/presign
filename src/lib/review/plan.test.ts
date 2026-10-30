// 计划步骤 + MCP 规则工具：用人工填的四份示例合同字段，经内存通道调真实的工具处理函数，
// 结论要覆盖 data/samples/answers.json 的标准答案，并且挂在标准答案引用的那段原文上。
// 这一层对了，审查流程的准确率就只取决于抽取步骤。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FactsSchema, type Src } from "./facts.ts";
import { planChecks } from "./plan.ts";
import { SAMPLE_FACTS } from "./sample-facts.ts";
import { sameSpot } from "./text.ts";
import { toolsFromClient, type Tools } from "./tools.ts";

type Answer = { rule: string; verdict: string; quote: string };
const answers = JSON.parse(readFileSync("data/samples/answers.json", "utf8")) as {
  samples: { id: string; file: string; findings: Answer[] }[];
};

let dir: string;
let tools: Tools;
let closeStore: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "plan-"));
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

function allSrcs(v: unknown): Src[] {
  if (Array.isArray(v)) return v.flatMap(allSrcs);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const own = typeof o.quote === "string" && "clause" in o ? [o as Src] : [];
    return [...own, ...Object.values(o).flatMap(allSrcs)];
  }
  return [];
}

describe("示例合同的人工字段", () => {
  for (const s of answers.samples) {
    it(`${s.id}：符合抽取结构，每段 quote 都原样出现在合同里`, () => {
      const facts = SAMPLE_FACTS[s.id];
      expect(FactsSchema.safeParse(facts).success).toBe(true);
      const text = readFileSync(`data/samples/${s.file}`, "utf8");
      for (const src of allSrcs(facts)) expect(text, src.quote).toContain(src.quote);
    });
  }
});

describe("计划步骤调规则工具", () => {
  for (const s of answers.samples) {
    it(`${s.id}：标准答案的每条结论都给出了，并且挂在同一段原文上`, async () => {
      const got: { rule: string; verdict: string; quote: string | null }[] = [];
      for (const c of planChecks(SAMPLE_FACTS[s.id])) {
        const r = (await tools.call(c.tool, c.args)) as {
          findings: { rule: string; verdict: string }[];
        };
        for (const f of r.findings) got.push({ ...f, quote: c.src?.quote ?? null });
      }
      for (const a of s.findings) {
        const hit = got.find(
          (g) =>
            g.rule === a.rule &&
            g.verdict === a.verdict &&
            // 必备条款看全文，不挂在某一段上
            (a.rule === "R11" || (g.quote !== null && sameSpot(g.quote, a.quote))),
        );
        expect(hit, `${a.rule} ${a.verdict}「${a.quote}」`).toBeTruthy();
      }
    });
  }

  it("每次调用都有检查记录里显示的一行，ID 不重复", () => {
    const checks = planChecks(SAMPLE_FACTS.labor);
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
    expect(checks.every((c) => c.label.length > 0)).toBe(true);
    expect(checks.find((c) => c.tool === "check_probation")?.label).toBe(
      "试用期：合同 2027-07-01 至 2029-06-30，试用期 3 个月",
    );
  });

  it("三方协议的违约金走 check_tripartite，不走劳动合同法第二十五条", () => {
    const tools = planChecks(SAMPLE_FACTS.tripartite).map((c) => c.tool);
    expect(tools).toContain("check_tripartite");
    expect(
      planChecks(SAMPLE_FACTS.tripartite).filter(
        (c) => c.tool === "check_penalty" && "penalties" in c.args,
      ),
    ).toEqual([]);
  });

  it("试用期没写月数也没写天数时不调 check_probation，免得传出不合法的参数", () => {
    const f = {
      ...SAMPLE_FACTS.labor,
      probation: { months: null, days: null, src: SAMPLE_FACTS.labor.probation!.src },
    };
    expect(planChecks(f).filter((c) => c.tool === "check_probation")).toEqual([]);
  });
});
