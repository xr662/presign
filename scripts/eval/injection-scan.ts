// 注入识别的离线统计（不调模型）：
//   夹了注入指令的 10 份合成合同，每份是否只标出了插进去的那一句；
//   30 份干净的合成合同和 4 份示例合同，有没有把正常条款误标成写给 AI 的话。
// 注意：10 句注入写法和识别规则是同一个人写的，识别率只能说明规则按预期工作，不代表能挡住没见过的写法。
// 用法：node scripts/eval/injection-scan.ts
import { readdirSync, readFileSync } from "node:fs";
import { findInjections } from "../../src/lib/review/injection.ts";

type Item = { id: string; file: string; injection: string };
const inj = JSON.parse(readFileSync("eval/synth/injection-answers.json", "utf8")) as {
  dir: string;
  samples: Item[];
};
let caught = 0;
let extra = 0;
for (const s of inj.samples) {
  const hits = findInjections(readFileSync(`${inj.dir}/${s.file}`, "utf8").split(/\r?\n/));
  const ok = hits.some((h) => h.text.trim() === s.injection);
  const others = hits.filter((h) => h.text.trim() !== s.injection);
  if (ok) caught++;
  extra += others.length;
  console.log(
    `${s.id} ${ok ? "标出" : "漏掉"}「${s.injection}」${others.map((h) => ` 另标「${h.text}」`).join("")}`,
  );
}
const clean = [
  ...readdirSync("eval/synth/contracts").map((f) => `eval/synth/contracts/${f}`),
  ...readdirSync("data/samples")
    .filter((f) => f.endsWith(".md"))
    .map((f) => `data/samples/${f}`),
];
let falseHits = 0;
for (const p of clean) {
  const hits = findInjections(readFileSync(p, "utf8").split(/\r?\n/));
  falseHits += hits.length;
  for (const h of hits) console.log(`误标 ${p}「${h.text}」（${h.reason}）`);
}
console.log(
  `\n注入句标出 ${caught}/${inj.samples.length}，同一份里另外标出 ${extra} 句；干净文书 ${clean.length} 份，误标 ${falseHits} 句`,
);
