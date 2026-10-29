// 把 data/raw/ 下的官方页面切成条文，写到 data/clean/<id>.json（进仓库，评委能直接看到入库的原文）。
// 条文 ID：<来源 id>-<条号>，款：<来源 id>-<条号>-<款号>，如 ldhtf-19-1。
// 典型案例写到 data/clean/cases/<id>.json，每个案例切成基本案情、裁判结果、典型意义三段。
// 用法：node scripts/corpus/parse.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeHtml, htmlToLines } from "../../mcp/labor-law/text.ts";
import { parseArticles, type Article } from "../../mcp/labor-law/parse-law.ts";
import { parseCases } from "../../mcp/labor-law/parse-cases.ts";

type Source = {
  id: string;
  title: string;
  short: string;
  level: string;
  version: string;
  status: string;
  url: string;
  publisher: string;
  expectArticles?: number;
  onlyArticles?: number[];
  abolished?: { article: number; paragraph: number; by: string }[];
};

const cfg = JSON.parse(readFileSync("data/sources.json", "utf8")) as { sources: Source[] };
mkdirSync("data/clean/cases", { recursive: true });

let problems = 0;
for (const s of cfg.sources) {
  const raw = `data/raw/${s.id}.html`;
  if (!existsSync(raw)) {
    console.log(`缺少 ${raw}，先运行 corpus:fetch`);
    problems++;
    continue;
  }
  const meta = JSON.parse(readFileSync(`data/raw/${s.id}.meta.json`, "utf8")) as {
    url: string;
    fetchedAt: string;
  };
  let articles: Article[] = parseArticles(htmlToLines(decodeHtml(readFileSync(raw))));

  if (s.expectArticles && articles.length !== s.expectArticles) {
    console.log(`× ${s.id}：解析出 ${articles.length} 条，应为 ${s.expectArticles} 条`);
    problems++;
  }
  if (s.onlyArticles) {
    const missing = s.onlyArticles.filter((n) => !articles.some((a) => a.no === n));
    if (missing.length) {
      console.log(`× ${s.id}：缺第 ${missing.join("、")} 条`);
      problems++;
    }
    articles = articles.filter((a) => s.onlyArticles!.includes(a.no));
  }
  // 已被废止的款打标，检索时仍能查到，但界面标明"已废止"，规则不引用
  for (const ab of s.abolished ?? []) {
    const p = articles
      .find((a) => a.no === ab.article)
      ?.paragraphs.find((x) => x.no === ab.paragraph);
    if (p) {
      p.status = "abolished";
      p.note = `已被${ab.by}废止`;
    }
  }

  const out = {
    id: s.id,
    title: s.title,
    short: s.short,
    level: s.level,
    version: s.version,
    status: s.status,
    publisher: s.publisher,
    sourceUrl: meta.url,
    fetchedAt: meta.fetchedAt,
    articles: articles.map((a) => ({
      id: `${s.id}-${a.no}`,
      ...a,
      paragraphs: a.paragraphs.map((p) => ({ id: `${s.id}-${a.no}-${p.no}`, ...p })),
    })),
  };
  writeFileSync(`data/clean/${s.id}.json`, JSON.stringify(out, null, 2) + "\n");
  const last = articles.at(-1);
  console.log(
    `${s.id}：${articles.length} 条；最后一条 ${last?.label}：${last?.text.slice(0, 60).replace(/\n/g, " / ")}`,
  );
}
if (problems) process.exit(1);

// ── 典型案例 ──────────────────────────────────────────
type CaseSource = { id: string; title: string; url: string; publisher: string };
const caseCfg = JSON.parse(readFileSync("data/sources.json", "utf8")) as { cases: CaseSource[] };
for (const c of caseCfg.cases) {
  const meta = JSON.parse(readFileSync(`data/raw/${c.id}.meta.json`, "utf8")) as {
    url: string;
    fetchedAt: string;
  };
  const cases = parseCases(htmlToLines(decodeHtml(readFileSync(`data/raw/${c.id}.html`))));
  const bad = cases.filter(
    (x) => !x.title || x.sections.length !== 3 || x.sections.some((s) => !s.text),
  );
  if (cases.length === 0 || bad.length) {
    console.log(
      `× ${c.id}：${cases.length} 个案例，结构不完整的：${bad.map((x) => x.no).join("、")}`,
    );
    process.exitCode = 1;
  }
  const out = {
    id: c.id,
    title: c.title,
    publisher: c.publisher,
    sourceUrl: meta.url,
    fetchedAt: meta.fetchedAt,
    cases: cases.map((x) => ({
      id: `${c.id}-${x.no}`,
      ...x,
      sections: x.sections.map((s) => ({ id: `${c.id}-${x.no}-${s.kind}`, ...s })),
    })),
  };
  writeFileSync(`data/clean/cases/${c.id}.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `${c.id}：${cases.length} 个案例；${cases.map((x) => x.title.split("——")[0]).join(" / ")}`,
  );
}
