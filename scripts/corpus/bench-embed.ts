// 向量模型实测：加载耗时、常驻内存、单次查询耗时、全量语料编码耗时，外加几条查询看排在前面的条文对不对。
// 结果写进 PROGRESS（T03 验收要求）。服务器上也跑同一个脚本，数字以服务器为准。
// 用法：node scripts/corpus/bench-embed.ts [--threads 1] [--skip-corpus]
import { readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dot, Embedder } from "../../mcp/labor-law/embed.ts";

const arg = (k: string) => process.argv[process.argv.indexOf(k) + 1];
const threads = process.argv.includes("--threads") ? Number(arg("--threads")) : 1;
const mb = () => (process.memoryUsage().rss / 1024 / 1024).toFixed(0);

console.log(`CPU：${cpus()[0].model.trim()} × ${cpus().length}，线程数 ${threads}`);
console.log(`启动时内存 ${mb()} MB`);
let t = performance.now();
const emb = await Embedder.load(undefined, threads);
console.log(`加载模型 ${(performance.now() - t).toFixed(0)} ms，内存 ${mb()} MB`);

const queries = [
  "合同两年试用期三个月合法吗",
  "公司要求提前离职赔偿违约金",
  "入职交押金",
  "约定不交社保",
  "离职后竞业限制没有补偿",
  "试用期工资打八折",
  "单方调岗降薪",
  "三方协议违约金",
];
await emb.embedQuery("预热");
const times: number[] = [];
for (let r = 0; r < 3; r++)
  for (const q of queries) {
    t = performance.now();
    await emb.embedQuery(q);
    times.push(performance.now() - t);
  }
times.sort((a, b) => a - b);
console.log(
  `单次查询 中位数 ${times[Math.floor(times.length / 2)].toFixed(1)} ms，最慢 ${times.at(-1)!.toFixed(1)} ms，内存 ${mb()} MB`,
);

if (!process.argv.includes("--skip-corpus")) {
  type Clean = { short: string; articles: { id: string; label: string; text: string }[] };
  const docs = readdirSync("data/clean")
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const d = JSON.parse(readFileSync(`data/clean/${f}`, "utf8")) as Clean;
      return d.articles.map((a) => ({ id: a.id, text: `${d.short}${a.label} ${a.text}` }));
    });
  const lens = docs.map((d) => emb.tokenizer.encode(d.text).length).sort((a, b) => a - b);
  console.log(
    `语料 ${docs.length} 条，token 数 中位数 ${lens[lens.length >> 1]}，最长 ${lens.at(-1)}，超过 512 的 ${lens.filter((l) => l >= 512).length} 条`,
  );
  t = performance.now();
  const vecs: Float32Array[] = [];
  for (let i = 0; i < docs.length; i += 8)
    vecs.push(...(await emb.embed(docs.slice(i, i + 8).map((d) => d.text))));
  console.log(`全量编码 ${((performance.now() - t) / 1000).toFixed(1)} s，内存 ${mb()} MB`);

  for (const q of queries) {
    const qv = await emb.embedQuery(q);
    const top = docs
      .map((d, i) => ({ id: d.id, s: dot(qv, vecs[i]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
    console.log(`「${q}」→ ${top.map((x) => `${x.id}(${x.s.toFixed(2)})`).join(" ")}`);
  }
}
