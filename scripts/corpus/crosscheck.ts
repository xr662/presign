// 交叉核对：用另一家政府网站的转载，按同样规则切条，和入库文本逐条比较。
// 两份文本独立排版，一份切错了（漏项、两款并成一款、混进页面文字），对比就会对不上。
// 比较前统一全角半角、去掉空白，只报文字差异。
// 用法：node scripts/corpus/crosscheck.ts [--sample 10]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeHtml, htmlToLines } from "../../mcp/labor-law/text.ts";
import { parseArticles } from "../../mcp/labor-law/parse-law.ts";

type Source = {
  checkMode?: "merge";
  id: string;
  short: string;
  checkUrls?: string[];
  knownDiffs?: Record<string, string>;
};
type Clean = { articles: { id: string; no: number; label: string; text: string }[] };

const cfg = JSON.parse(readFileSync("data/sources.json", "utf8")) as { sources: Source[] };
const sampleArg = process.argv.indexOf("--sample");
const sampleSize = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 10;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

// 全角转半角、统一引号和括号，去掉所有空白
export function normalize(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[“”"]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/〔|［/g, "[")
    .replace(/〕|］/g, "]")
    .replace(/\s+/g, "");
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `入库「${a.slice(Math.max(0, i - 12), i + 18)}」 对照「${b.slice(Math.max(0, i - 12), i + 18)}」`;
}

let mismatched = 0;
const matched: { id: string; label: string; short: string; len: number }[] = [];

for (const s of cfg.sources) {
  if (!s.checkUrls) continue;
  const clean = JSON.parse(readFileSync(`data/clean/${s.id}.json`, "utf8")) as Clean;
  let other: ReturnType<typeof parseArticles> = [];
  let usedUrl = "";
  for (const url of s.checkUrls) {
    const cache = `data/raw/${s.id}.check-${s.checkUrls.indexOf(url)}.html`;
    try {
      if (!existsSync(cache)) {
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(40_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(cache, new Uint8Array(await res.arrayBuffer()));
      }
      const parsed = parseArticles(htmlToLines(decodeHtml(readFileSync(cache))));
      // merge：只收了部分条文的法规（民法典），对照页也是按编分开的，几页合起来用
      if (s.checkMode === "merge") {
        other.push(...parsed.filter((p) => !other.some((o) => o.no === p.no)));
        usedUrl = usedUrl ? `${usedUrl} + ${url}` : url;
        continue;
      }
      other = parsed;
      if (other.length >= clean.articles.length * 0.9) {
        usedUrl = url;
        break;
      }
      console.log(`  ${s.id} 对照页 ${url} 只切出 ${other.length} 条，换下一个`);
    } catch (e) {
      console.log(`  ${s.id} 对照页 ${url} 读取失败：${(e as Error).message}`);
    }
  }
  if (!usedUrl) {
    console.log(`? ${s.id}：没有可用的对照页`);
    continue;
  }

  let diff = 0;
  let noted = 0;
  for (const a of clean.articles) {
    const b = other.find((x) => x.no === a.no);
    if (!b) {
      if (s.knownDiffs?.[a.id]) {
        console.log(`  ${a.id}：对照页没有，${s.knownDiffs[a.id]}`);
        noted++;
      } else {
        console.log(`× ${a.id}：对照页没有${a.label}`);
        diff++;
      }
      continue;
    }
    const na = normalize(a.text);
    const nb = normalize(b.text);
    if (na === nb) {
      matched.push({ id: a.id, label: a.label, short: s.short, len: a.text.length });
    } else if (s.knownDiffs?.[a.id]) {
      // 对照页本身有错、已经用第三个来源核实过的，记录在 sources.json，不算差异
      console.log(`  ${a.id}：已核实，${s.knownDiffs[a.id]}`);
      noted++;
    } else {
      diff++;
      console.log(`× ${a.id}：${firstDiff(na, nb)}`);
    }
  }
  mismatched += diff;
  console.log(
    `${s.id}：${clean.articles.length} 条，${clean.articles.length - diff - noted} 条一致${noted ? `，${noted} 条另行核实` : ""}（对照 ${usedUrl}）`,
  );
}

// 固定种子抽样，每次运行抽到的一样，写进验收记录
let seed = 20261030;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const sample = [...matched].sort(() => rand() - 0.5).slice(0, sampleSize);
console.log(`\n抽样 ${sample.length} 条（与对照页逐字一致）：`);
for (const m of sample) console.log(`  ${m.id}  ${m.short}${m.label}  ${m.len} 字`);
console.log(`\n共 ${matched.length} 条一致，${mismatched} 条有差异`);
