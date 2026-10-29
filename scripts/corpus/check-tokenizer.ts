// 分词器核对：把语料全文和一批边界情况交给官方 tokenizers 库（Python）和我们的实现，逐个 id 比较。
// 用法：node scripts/corpus/check-tokenizer.ts <python 路径>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BertTokenizer, MODEL_DIR } from "../../mcp/labor-law/embed.ts";

const python = process.argv[2] ?? "python";
const edge = [
  "HR说offer里写的试用期6个月，App上也能签",
  "月薪５０００元，¥8,000.50；试用期（一）至（三）",
  "2027-07-01至2029-06-30 Deepseek-v4-flash",
  "café naïve ÀÉÎ",
  "全角空格\u3000制表\t换行\n回车\r零宽\u200b控制\u0007",
  "表情😀和生僻字𠀀𪚥",
  "超长英文单词" + "a".repeat(120),
  "“引号”‘单引号’——破折号……省略号·间隔号",
  "",
];
const texts = [
  ...edge,
  ...readdirSync("data/clean")
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) =>
      (
        JSON.parse(readFileSync(`data/clean/${f}`, "utf8")) as { articles: { text: string }[] }
      ).articles.map((a) => a.text),
    ),
];
const dir = mkdtempSync(join(tmpdir(), "tok-"));
writeFileSync(join(dir, "texts.json"), JSON.stringify(texts));
execFileSync(
  python,
  [
    "-I",
    "scripts/corpus/check-tokenizer.py",
    `${MODEL_DIR}/tokenizer.json`,
    join(dir, "texts.json"),
    join(dir, "ids.json"),
  ],
  { stdio: "inherit" },
);
const want = JSON.parse(readFileSync(join(dir, "ids.json"), "utf8")) as number[][];

const tok = new BertTokenizer();
let bad = 0;
texts.forEach((t, i) => {
  // 官方库默认不截断，我们的 encode 截到 512，比较时只看前 512 个
  const ours = tok.encode(t);
  const ref = want[i].length > 512 ? [...want[i].slice(0, 511), tok.sep] : want[i];
  if (ours.join(",") !== ref.join(",")) {
    bad++;
    const k = ours.findIndex((x, j) => x !== ref[j]);
    console.log(
      `× 第 ${i} 条「${t.slice(0, 30)}」第 ${k} 个 token：我们 ${ours.slice(k, k + 5)}，官方 ${ref.slice(k, k + 5)}`,
    );
  }
});
console.log(`${texts.length} 条文本，${texts.length - bad} 条完全一致`);
if (bad) process.exit(1);
