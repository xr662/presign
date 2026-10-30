// T08 检索评测：同一组查询在六种配置下的前 5 命中率，加每一步耗时。
//   text      原句，只走全文
//   vector    原句，只走向量
//   hybrid    原句，全文 + 向量 RRF
//   hybrid+rr 原句，RRF 后模型重排
//   rewrite   原句 + 模型改写的 2~3 个查询，RRF
//   full      改写 + RRF + 重排（线上用的配置）
// 命中：gold 里任意一条进了前 5；主依据命中：gold 第一条进了前 5；候选召回：gold 任意一条进了送去重排的前 20。
// 后三种调模型，每条查询 3 次请求（改写 1、重排 2）。
//
// 不加 --liftoff-only：那个参数是为了服务器上省内存，本机加了以后向量编码从每条约 25ms 变成 300~490ms，
// 和服务器（T03 实测加参数后约 53ms）都对不上。服务器上的检索耗时按 T03 的数字另算。
//
// 用法：node scripts/eval/retrieval.ts [--set test|dev] [--rounds 1] [--no-model] [--only t01,t02] [--no-save]
// 结果写 eval/results/<日期>-retrieval-<set>.json（只存 ID 和数字，不存条文原文）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { Embedder } from "../../mcp/labor-law/embed.ts";
import { hybridSearch } from "../../mcp/labor-law/search.ts";
import { LawStore } from "../../mcp/labor-law/store.ts";
import { limitsFromEnv, rolesFromEnv } from "../../src/lib/ai/config.ts";
import { createAi } from "../../src/lib/ai/core.ts";
import { UsageStore } from "../../src/lib/ai/usage.ts";
import { rerankPrompt, retrieve, type SearchFn } from "../../src/lib/review/retrieve.ts";
import { RERANK_PROMPT, REWRITE_PROMPT } from "../../src/prompts/retrieval.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const set = arg("--set", "test");
const rounds = Number(arg("--rounds", "1"));
const useModel = !argv.includes("--no-model");
const only = argv.includes("--only") ? new Set(arg("--only", "").split(",")) : null;

type Query = { id: string; kind: "clause" | "question"; text: string; gold: string[] };
const all = (JSON.parse(readFileSync(`eval/retrieval/${set}.json`, "utf8")) as { queries: Query[] })
  .queries;
const queries = only ? all.filter((q) => only.has(q.id)) : all;

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 时只能跑 --no-model
}
const roles = rolesFromEnv();
if (useModel && roles.length === 0) {
  console.error("没有配置模型（.env.local），只能加 --no-model 跑前三种配置");
  process.exit(1);
}

const store = new LawStore(process.env.LAW_DB_PATH || "data/build/law.db");
const embedder = await Embedder.load();
const usage = new UsageStore(":memory:");
const ai = createAi({ roles, limits: limitsFromEnv(), usage });
const search: SearchFn = (qs, k) => hybridSearch(store, embedder, qs, { k });

const CONFIGS = ["text", "vector", "hybrid", "hybrid+rr", "rewrite", "full"] as const;
type Config = (typeof CONFIGS)[number];
type Run = {
  id: string;
  round: number;
  top: Partial<Record<Config, string[]>>;
  pool: { raw: string[]; rewrite?: string[] };
  rewrites?: string[];
  degraded: string[];
  ms?: { rewrite: number; search: number; rerankRaw: number; rerank: number; total: number };
  promptChars?: number;
};

const runs: Run[] = [];
const t0 = performance.now();
for (let round = 1; round <= (useModel ? rounds : 1); round++) {
  for (const q of queries) {
    const run: Run = { id: q.id, round, top: {}, pool: { raw: [] }, degraded: [] };
    const ids = (hs: { id: string }[]) => hs.map((h) => h.id);
    run.top.text = ids(await hybridSearch(store, embedder, [q.text], { k: 5, only: "text" }));
    run.top.vector = ids(await hybridSearch(store, embedder, [q.text], { k: 5, only: "vector" }));
    run.pool.raw = ids(await search([q.text], 20));
    run.top.hybrid = run.pool.raw.slice(0, 5);

    if (useModel) {
      const raw = await retrieve({ text: q.text }, { ai, search }, { rewrite: false });
      const full = await retrieve({ text: q.text }, { ai, search });
      run.top["hybrid+rr"] = ids(raw.hits).slice(0, 5);
      run.pool.rewrite = ids(full.pool);
      run.top.rewrite = run.pool.rewrite.slice(0, 5);
      run.top.full = ids(full.hits).slice(0, 5);
      run.rewrites = full.queries.slice(1);
      run.degraded = [...raw.degraded, ...full.degraded].map((d) => `${d.step}:${d.reason}`);
      run.ms = {
        rewrite: full.ms.rewrite,
        search: full.ms.search,
        rerankRaw: raw.ms.rerank,
        rerank: full.ms.rerank,
        total: full.ms.total,
      };
      run.promptChars = rerankPrompt({ text: q.text }, full.pool).length;
    }
    runs.push(run);
    const mark = (c: Config) => {
      const top = run.top[c];
      if (!top) return "";
      const r = top.findIndex((id) => q.gold.includes(id));
      return `${c}:${r < 0 ? "×" : r + 1}`;
    };
    console.log(
      `${q.id} ${CONFIGS.map(mark).filter(Boolean).join(" ")}` +
        (run.ms ? ` ${(run.ms.total / 1000).toFixed(1)}s` : "") +
        (run.degraded.length ? ` 降级 ${run.degraded.join(",")}` : ""),
    );
  }
}

// ── 汇总 ────────────────────────────────────────────────
const gold = new Map(queries.map((q) => [q.id, q.gold]));
const kindOf = new Map(queries.map((q) => [q.id, q.kind]));
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(0)}%`);
const hit = (ids: string[] | undefined, g: string[]) => !!ids && ids.some((id) => g.includes(id));

function rate(config: Config, filter: (r: Run) => boolean = () => true) {
  const rs = runs.filter((r) => r.top[config] && filter(r));
  const any = rs.filter((r) => hit(r.top[config], gold.get(r.id)!)).length;
  const primary = rs.filter((r) => r.top[config]!.includes(gold.get(r.id)![0])).length;
  const rr =
    rs.reduce((s, r) => {
      const i = r.top[config]!.findIndex((id) => gold.get(r.id)!.includes(id));
      return s + (i < 0 ? 0 : 1 / (i + 1));
    }, 0) / (rs.length || 1);
  return { n: rs.length, any, primary, mrr: Number(rr.toFixed(3)) };
}

const summary = Object.fromEntries(
  CONFIGS.map((c) => [
    c,
    {
      all: rate(c),
      clause: rate(c, (r) => kindOf.get(r.id) === "clause"),
      question: rate(c, (r) => kindOf.get(r.id) === "question"),
      // 改写和重排都正常完成的那些次（平台出故障降级的不算），看检索方法本身的效果
      clean: rate(c, (r) => r.degraded.length === 0),
    },
  ]),
);
const poolRecall = {
  raw: runs.filter((r) => hit(r.pool.raw, gold.get(r.id)!)).length,
  rewrite: runs.filter((r) => hit(r.pool.rewrite, gold.get(r.id)!)).length,
  n: runs.length,
};

const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const timed = runs.filter((r) => r.ms);
const latency = Object.fromEntries(
  (["rewrite", "search", "rerank", "total"] as const).map((k) => {
    const xs = timed.map((r) => r.ms![k]);
    return [k, { p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), max: Math.max(0, ...xs) }];
  }),
);

console.log(`\n${set}：${queries.length} 条查询 × ${useModel ? rounds : 1} 轮`);
console.log("| 配置 | 前 5 命中 | 主依据进前 5 | MRR | 条款原文 | 口语提问 | 没有降级的那些次 |");
console.log("|---|---|---|---|---|---|---|");
for (const c of CONFIGS) {
  const s = summary[c];
  if (s.all.n === 0) continue;
  console.log(
    `| ${c} | ${s.all.any}/${s.all.n}（${pct(s.all.any, s.all.n)}） | ${s.all.primary}/${s.all.n}（${pct(s.all.primary, s.all.n)}） | ${s.all.mrr} | ${pct(s.clause.any, s.clause.n)} | ${pct(s.question.any, s.question.n)} | ${s.clean.any}/${s.clean.n} |`,
  );
}
console.log(`有降级的：${runs.filter((r) => r.degraded.length > 0).length}/${runs.length} 次`);
console.log(
  `送去重排的前 20 里有 gold：原句 ${poolRecall.raw}/${poolRecall.n}` +
    (useModel ? `，改写后 ${poolRecall.rewrite}/${poolRecall.n}` : ""),
);
if (timed.length) {
  console.log("耗时（毫秒）：p50 / p90 / 最慢");
  for (const [k, v] of Object.entries(latency))
    console.log(`  ${k}: ${v.p50} / ${v.p90} / ${v.max}`);
  const chars = timed.map((r) => r.promptChars ?? 0);
  console.log(`重排提示词长度（字符）：中位数 ${quantile(chars, 0.5)}，最长 ${Math.max(...chars)}`);
  console.log("模型用量：");
  for (const row of usage.summary()) console.log("  ", JSON.stringify(row));
  const failures = usage.failures();
  if (failures.length) console.log("失败的调用：");
  for (const row of failures) console.log("  ", JSON.stringify(row));
}
console.log(`总耗时 ${((performance.now() - t0) / 1000).toFixed(0)} s`);

if (!argv.includes("--no-save")) {
  const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const out = `eval/results/${date}-retrieval-${set}.json`;
  mkdirSync("eval/results", { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        set,
        date,
        rounds: useModel ? rounds : 1,
        model: useModel ? roles[0].model : null,
        prompts: [REWRITE_PROMPT.version, RERANK_PROMPT.version],
        cpu: cpus()[0].model.trim(),
        summary,
        poolRecall,
        latency,
        usage: useModel ? usage.summary() : [],
        failures: useModel ? usage.failures() : [],
        runs,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`写入 ${out}`);
}
store.close();
