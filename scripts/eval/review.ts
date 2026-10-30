// T09 审查流程评测：四份示例合同走完整流程（真实模型 + 内存通道连 MCP 服务），和标准答案比。
//   命中：标准答案里的一条（规则 + 等级）在结论里出现，并且挂在同一段原文上
//   等级不同：规则对上、原文对上，等级不一样
//   额外批注：标准答案里没有的非 ok 结论，逐条打印出来人工看是误报还是合理补充
// 还记录每一步的耗时、模型调用次数和用量。每份合同约 4~6 次模型调用。
//
// 注意：四份示例合同在写提示词时看过，这里的数字是开发集上的；独立的评测集是 T17 的合成合同。
//
// 用法：node scripts/eval/review.ts [--only labor,offer] [--rounds 1] [--no-save] [--quiet] [--debug] [--record]
// --record：把第 1 轮每份合同的全文和完整事件存到 public/recordings/，示例合同页回放和端到端测试用
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, closeStore } from "../../mcp/labor-law/server.ts";
import { limitsFromEnv, rolesFromEnv } from "../../src/lib/ai/config.ts";
import { createAi } from "../../src/lib/ai/core.ts";
import { UsageStore } from "../../src/lib/ai/usage.ts";
import type { ReviewEvent, ReviewFinding } from "../../src/lib/review/events.ts";
import { runReview } from "../../src/lib/review/run.ts";
import { sameSpot } from "../../src/lib/review/text.ts";
import { toolsFromClient } from "../../src/lib/review/tools.ts";
import {
  EXTRACT_PROMPT,
  JUDGE_PROMPT,
  REPORT_PROMPT,
  VERIFY_PROMPT,
} from "../../src/prompts/review.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const only = argv.includes("--only") ? new Set(arg("--only", "").split(",")) : null;
const rounds = Number(arg("--rounds", "1"));
const quiet = argv.includes("--quiet");
// --debug：打印每次模型调用的输出（只在本机排查用，结果文件里不存）
const debug = argv.includes("--debug");
const record = argv.includes("--record");

process.loadEnvFile(".env.local");
const roles = rolesFromEnv();
if (roles.length === 0) throw new Error("没有配置模型（.env.local）");
const usage = new UsageStore(":memory:");
const base = createAi({ roles, limits: limitsFromEnv(), usage });
const ai: Pick<typeof base, "generateObject"> = {
  generateObject: async (purpose, schema, o) => {
    const r = await base.generateObject(purpose, schema, o);
    if (debug)
      console.log(`--- ${purpose} 输出
${JSON.stringify(r, null, 1)}`);
    return r;
  },
};

type Answer = { rule: string; verdict: string; quote: string };
type Sample = { id: string; file: string; kind: string; findings: Answer[] };
const samples = (
  JSON.parse(readFileSync("data/samples/answers.json", "utf8")) as { samples: Sample[] }
).samples.filter((s) => !only || only.has(s.id));

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(a);
  const client = new Client({ name: "eval", version: "0" });
  await client.connect(b);
  return toolsFromClient(client);
}

const runs: unknown[] = [];
for (let round = 1; round <= rounds; round++)
  for (const s of samples) {
    const text = readFileSync(`data/samples/${s.file}`, "utf8");
    const tools = await connect();
    const events: ReviewEvent[] = [];
    const result = await runReview({ text }, { ai, tools }, (e) => {
      events.push(e);
      if (quiet) return;
      const t = `${(e.at / 1000).toFixed(1)}s`.padStart(6);
      if (e.type === "step") console.log(`${t} [${e.step} ${e.state}] ${e.text}`);
      if (e.type === "tool_call") console.log(`${t}   调用 ${e.tool}：${e.label}`);
      if (e.type === "finding")
        console.log(
          `${t}   结论 ${e.finding.rule ?? "模型"} ${e.finding.verdict}：${e.finding.title}`,
        );
      if (e.type === "verify" && !e.ok)
        console.log(`${t}   自检 ${e.findingId} 改为 ${e.verdict}：${e.reason}`);
      if (e.type === "error") console.log(`${t}   出错 ${e.code}：${e.message}`);
      if (e.type === "done")
        console.log(`${t}   完成：${e.summary}（模型调用 ${e.modelCalls} 次）`);
    });
    await tools.close();
    if (record && round === 1) {
      mkdirSync("public/recordings", { recursive: true });
      writeFileSync(
        `public/recordings/${s.id}.json`,
        `${JSON.stringify({ sample: s.id, kind: s.kind, recordedAt: new Date().toISOString().slice(0, 10), text, events })}\n`,
      );
    }

    // 和标准答案比
    const nonOk = (f: ReviewFinding) => f.verdict !== "ok";
    const matched = new Set<ReviewFinding>();
    const scored = s.findings.map((a) => {
      const spot = (f: ReviewFinding) =>
        a.rule === "R11" || (f.quote !== null && sameSpot(f.quote, a.quote));
      const hit = result.findings.find(
        (f) => f.rule === a.rule && f.verdict === a.verdict && spot(f),
      );
      const near = hit ? null : result.findings.find((f) => f.rule === a.rule && spot(f));
      if (hit) matched.add(hit);
      if (near) matched.add(near);
      // 从用户角度看的两项：有问题的条款有没有得到提醒（不论哪条规则、还是模型判断）；
      // 写对的条款有没有被误报（同一段原文上出现了非 ok 的结论）
      const onSpot = result.findings.filter((f) => f.quote !== null && sameSpot(f.quote, a.quote));
      if (a.verdict !== "ok") onSpot.filter(nonOk).forEach((f) => matched.add(f));
      const warned = a.verdict === "ok" ? null : onSpot.some(nonOk);
      const falseAlarm = a.verdict === "ok" ? onSpot.some(nonOk) : null;
      return {
        ...a,
        result: hit ? "hit" : near ? `verdict:${near.verdict}` : "miss",
        warned,
        falseAlarm,
      };
    });
    const extra = result.findings.filter((f) => nonOk(f) && !matched.has(f));
    const reported = new Set(events.flatMap((e) => (e.type === "report" ? [e.findingId] : [])));
    const steps = Object.fromEntries(
      events
        .filter(
          (e): e is Extract<ReviewEvent, { type: "step" }> =>
            e.type === "step" && e.state !== "running",
        )
        .map((e) => [e.step, e.at]),
    );
    console.log(
      `\n== ${s.id}（${s.kind}）第 ${round} 轮：${(result.ms / 1000).toFixed(1)} 秒，模型调用 ${result.modelCalls} 次`,
    );
    for (const x of scored)
      console.log(
        `  ${x.result === "hit" ? "✓" : "×"} ${x.rule} ${x.verdict}「${x.quote}」 ${x.result === "hit" ? "" : x.result}`,
      );
    for (const f of extra)
      console.log(`  + 额外 ${f.rule ?? "模型"} ${f.verdict}：${f.title}「${f.quote ?? "全文"}」`);
    console.log(
      `  报告写了 ${reported.size}/${result.findings.filter(nonOk).length} 条；步骤完成时刻 ${JSON.stringify(steps)}\n`,
    );
    runs.push({
      sample: s.id,
      round,
      ms: result.ms,
      modelCalls: result.modelCalls,
      stopped: result.stopped,
      steps,
      scored,
      extra: extra.map((f) => ({
        rule: f.rule,
        verdict: f.verdict,
        title: f.title,
        quote: f.quote,
        source: f.source,
      })),
      findings: result.findings.map((f) => ({
        id: f.id,
        rule: f.rule,
        verdict: f.verdict,
        title: f.title,
        clause: f.clause,
        quote: f.quote,
        basis: f.basis.map((b) => b.id),
        reported: reported.has(f.id),
      })),
      facts: result.facts,
    });
  }

type Scored = { result: string; warned: boolean | null; falseAlarm: boolean | null };
const all = runs as { scored: Scored[]; extra: unknown[]; ms: number }[];
const scoredAll = all.flatMap((r) => r.scored);
const hits = scoredAll.filter((x) => x.result === "hit").length;
const total = scoredAll.length;
const bad = scoredAll.filter((x) => x.warned !== null);
const good = scoredAll.filter((x) => x.falseAlarm !== null);
console.log(
  `合计：规则和等级都对上 ${hits}/${total} 条，额外批注 ${all.reduce((n, r) => n + r.extra.length, 0)} 条`,
);
console.log(
  `  有问题的条款得到提醒 ${bad.filter((x) => x.warned).length}/${bad.length}；写对的条款被误报 ${good.filter((x) => x.falseAlarm).length}/${good.length}`,
);
console.log(`耗时（秒）：${all.map((r) => (r.ms / 1000).toFixed(1)).join("、")}`);
console.log("模型用量：");
for (const row of usage.summary()) console.log("  ", JSON.stringify(row));
for (const row of usage.failures()) console.log("   失败", JSON.stringify(row));

if (!argv.includes("--no-save")) {
  const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  mkdirSync("eval/results", { recursive: true });
  const out = `eval/results/${date}-review.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        date,
        model: roles[0].model,
        prompts: [
          EXTRACT_PROMPT.version,
          JUDGE_PROMPT.version,
          VERIFY_PROMPT.version,
          REPORT_PROMPT.version,
        ],
        hits,
        total,
        warned: { yes: bad.filter((x) => x.warned).length, of: bad.length },
        falseAlarm: { yes: good.filter((x) => x.falseAlarm).length, of: good.length },
        usage: usage.summary(),
        failures: usage.failures(),
        runs,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`写入 ${out}`);
}
closeStore();
