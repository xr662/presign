// 把几次审查评测的结果文件按规则拆开对比（不调模型）。
// 用法：node scripts/eval/compare.ts eval/results/2026-11-16-review-synth.json eval/results/2026-11-16-review-synth-A.json
// 每个文件一列，每条规则一行：规则和等级都对上 / 标准答案条数；最后几行是有问题的条款得到提醒、写对的条款被误报、额外批注、耗时。
import { readFileSync } from "node:fs";

type Scored = {
  rule: string;
  verdict: string;
  result: string;
  warned: boolean | null;
  falseAlarm: boolean | null;
};
type Run = {
  sample: string;
  ms: number;
  scored: Scored[];
  extra: { rule: string | null; verdict: string }[];
};
type Result = { set?: string; config?: string; runs: Run[] };

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("给出至少一个结果文件");
const results = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as Result);
const name = (r: Result, i: number) => `${r.set ?? "samples"}-${r.config ?? "D"}#${i + 1}`;

const rules = [
  ...new Set(results.flatMap((r) => r.runs.flatMap((x) => x.scored.map((s) => s.rule)))),
].sort();
const cell = (xs: Scored[]) => `${xs.filter((x) => x.result === "hit").length}/${xs.length}`;
console.log(["规则", ...results.map(name)].join("\t"));
for (const rule of rules)
  console.log(
    [
      rule,
      ...results.map((r) => cell(r.runs.flatMap((x) => x.scored).filter((s) => s.rule === rule))),
    ].join("\t"),
  );

const row = (label: string, f: (r: Result) => string) =>
  console.log([label, ...results.map(f)].join("\t"));
const scored = (r: Result) => r.runs.flatMap((x) => x.scored);
row("合计", (r) => cell(scored(r)));
row("非 ok 对上", (r) => cell(scored(r).filter((s) => s.verdict !== "ok")));
row("ok 对上", (r) => cell(scored(r).filter((s) => s.verdict === "ok")));
row("得到提醒", (r) => {
  const bad = scored(r).filter((s) => s.warned !== null);
  return `${bad.filter((s) => s.warned).length}/${bad.length}`;
});
row("误报", (r) => {
  const good = scored(r).filter((s) => s.falseAlarm !== null);
  return `${good.filter((s) => s.falseAlarm).length}/${good.length}`;
});
row("额外批注", (r) => String(r.runs.reduce((n, x) => n + x.extra.length, 0)));
row("耗时中位数（秒）", (r) => {
  const ms = r.runs.map((x) => x.ms).sort((a, b) => a - b);
  return (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1);
});
row("耗时最长（秒）", (r) => (Math.max(...r.runs.map((x) => x.ms)) / 1000).toFixed(1));

// 每份合同对上的条数，看波动集中在哪几份
console.log("\n每份合同对上");
const ids = [...new Set(results.flatMap((r) => r.runs.map((x) => x.sample)))];
for (const id of ids)
  console.log(
    [
      id,
      ...results.map(
        (r) =>
          r.runs
            .filter((x) => x.sample === id)
            .map((x) => cell(x.scored))
            .join(" ") || "-",
      ),
    ].join("\t"),
  );
