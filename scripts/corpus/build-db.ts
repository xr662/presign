// 由 data/clean/ 生成法规库 data/build/law.db：法条、款、案例、检索单元、全文索引、向量。
// 向量按"文本 + 模型"的哈希缓存：重建时文本没变的条文直接沿用旧库里的向量，不用再算一遍。
// 先写到临时文件，成功后再替换，正在运行的服务不会读到写了一半的库。
// 用法：node scripts/corpus/build-db.ts [--no-vectors] [--threads 4] [--out data/build/law.db]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bigrams } from "../../mcp/labor-law/text.ts";

const arg = (k: string, d: string) =>
  process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const OUT = arg("--out", "data/build/law.db");
const withVectors = !process.argv.includes("--no-vectors");
const threads = Number(arg("--threads", String(Math.max(1, Math.floor(cpus().length / 2)))));

type Para = {
  id: string;
  no: number;
  text: string;
  items: string[];
  status?: string;
  note?: string;
};
type Art = {
  id: string;
  no: number;
  label: string;
  chapter?: string;
  section?: string;
  text: string;
  paragraphs: Para[];
};
type Law = {
  id: string;
  title: string;
  short: string;
  level: string;
  version: string;
  status: string;
  publisher: string;
  sourceUrl: string;
  fetchedAt: string;
  articles: Art[];
};
type CaseFile = {
  id: string;
  title: string;
  sourceUrl: string;
  cases: {
    id: string;
    no: number;
    title: string;
    sections: { id: string; kind: string; heading: string; text: string }[];
  }[];
};

const laws = readdirSync("data/clean")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`data/clean/${f}`, "utf8")) as Law);
const caseFiles = readdirSync("data/clean/cases").map(
  (f) => JSON.parse(readFileSync(`data/clean/cases/${f}`, "utf8")) as CaseFile,
);

// 检索单元：一条法条或案例的一段。已废止的款不进检索文本（按 ID 仍能取到原文和废止说明）
type Doc = { id: string; kind: "article" | "case"; title: string; text: string };
const docs: Doc[] = [];
for (const l of laws)
  for (const a of l.articles)
    docs.push({
      id: a.id,
      kind: "article",
      title: `${l.short}${a.label}`,
      text: a.paragraphs
        .filter((p) => p.status !== "abolished")
        .map((p) => p.text)
        .join("\n"),
    });
for (const cf of caseFiles)
  for (const c of cf.cases)
    for (const s of c.sections)
      docs.push({
        id: s.id,
        kind: "case",
        title: `典型案例：${c.title}（${s.heading}）`,
        text: s.text,
      });

const tmp = `${OUT}.tmp`;
mkdirSync(dirname(OUT), { recursive: true });
rmSync(tmp, { force: true });
const db = new DatabaseSync(tmp);
db.exec(`
  PRAGMA journal_mode = OFF;
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE laws(id TEXT PRIMARY KEY, title TEXT, short TEXT, level TEXT, version TEXT, status TEXT,
                    publisher TEXT, source_url TEXT, fetched_at TEXT);
  CREATE TABLE articles(id TEXT PRIMARY KEY, law_id TEXT, no INTEGER, label TEXT, chapter TEXT, section TEXT, text TEXT);
  CREATE TABLE paragraphs(id TEXT PRIMARY KEY, article_id TEXT, no INTEGER, text TEXT, items TEXT, status TEXT, note TEXT);
  CREATE TABLE cases(id TEXT PRIMARY KEY, source_id TEXT, no INTEGER, title TEXT, source_url TEXT);
  CREATE TABLE case_sections(id TEXT PRIMARY KEY, case_id TEXT, kind TEXT, heading TEXT, text TEXT);
  CREATE TABLE docs(id TEXT PRIMARY KEY, kind TEXT, title TEXT, text TEXT, hash TEXT);
  CREATE VIRTUAL TABLE docs_fts USING fts5(id UNINDEXED, body, tokenize = 'unicode61');
  CREATE TABLE vectors(doc_id TEXT, chunk INTEGER, vec BLOB, PRIMARY KEY (doc_id, chunk));
  CREATE INDEX paragraphs_article ON paragraphs(article_id);
`);

db.exec("BEGIN");
const insLaw = db.prepare("INSERT INTO laws VALUES (?,?,?,?,?,?,?,?,?)");
const insArt = db.prepare("INSERT INTO articles VALUES (?,?,?,?,?,?,?)");
const insPara = db.prepare("INSERT INTO paragraphs VALUES (?,?,?,?,?,?,?)");
for (const l of laws) {
  insLaw.run(
    l.id,
    l.title,
    l.short,
    l.level,
    l.version,
    l.status,
    l.publisher,
    l.sourceUrl,
    l.fetchedAt,
  );
  for (const a of l.articles) {
    insArt.run(a.id, l.id, a.no, a.label, a.chapter ?? null, a.section ?? null, a.text);
    for (const p of a.paragraphs)
      insPara.run(
        p.id,
        a.id,
        p.no,
        p.text,
        JSON.stringify(p.items),
        p.status ?? null,
        p.note ?? null,
      );
  }
}
const insCase = db.prepare("INSERT INTO cases VALUES (?,?,?,?,?)");
const insSec = db.prepare("INSERT INTO case_sections VALUES (?,?,?,?,?)");
for (const cf of caseFiles)
  for (const c of cf.cases) {
    insCase.run(c.id, cf.id, c.no, c.title, cf.sourceUrl);
    for (const s of c.sections) insSec.run(s.id, c.id, s.kind, s.heading, s.text);
  }

const modelLock = existsSync("data/model-lock.json")
  ? readFileSync("data/model-lock.json", "utf8")
  : "";
const modelHash = createHash("sha256").update(modelLock).digest("hex").slice(0, 16);
const hashOf = (d: Doc) =>
  createHash("sha256").update(`${modelHash}\n${d.title}\n${d.text}`).digest("hex");
const insDoc = db.prepare("INSERT INTO docs VALUES (?,?,?,?,?)");
const insFts = db.prepare("INSERT INTO docs_fts (id, body) VALUES (?, ?)");
for (const d of docs) {
  insDoc.run(d.id, d.kind, d.title, d.text, hashOf(d));
  insFts.run(d.id, bigrams(`${d.title} ${d.text}`));
}
db.exec("COMMIT");

let reused = 0;
let computed = 0;
if (withVectors) {
  const { Embedder } = await import("../../mcp/labor-law/embed.ts");
  const emb = await Embedder.load(undefined, threads);

  // 旧库里文本哈希相同的向量直接沿用
  const cache = new Map<string, { chunk: number; vec: Uint8Array }[]>();
  if (existsSync(OUT)) {
    const old = new DatabaseSync(OUT, { readOnly: true });
    try {
      for (const r of old
        .prepare("SELECT d.hash, v.chunk, v.vec FROM vectors v JOIN docs d ON d.id = v.doc_id")
        .all() as { hash: string; chunk: number; vec: Uint8Array }[]) {
        cache.set(r.hash, [...(cache.get(r.hash) ?? []), { chunk: r.chunk, vec: r.vec }]);
      }
    } catch {
      // 旧库结构不同，全部重算
    }
    old.close();
  }

  // 超过 512 token 的条文按款分段，每段前面带上标题，各算一个向量
  const chunksOf = (d: Doc): string[] => {
    const whole = `${d.title} ${d.text}`;
    if (emb.tokenizer.encode(whole).length < 512) return [whole];
    const out: string[] = [];
    let cur = "";
    for (const p of d.text.split("\n")) {
      const next = cur ? `${cur}\n${p}` : p;
      if (cur && emb.tokenizer.encode(`${d.title} ${next}`).length >= 480) {
        out.push(`${d.title} ${cur}`);
        cur = p;
      } else cur = next;
    }
    if (cur) out.push(`${d.title} ${cur}`);
    return out;
  };

  const insVec = db.prepare("INSERT INTO vectors VALUES (?,?,?)");
  const pending: { id: string; chunk: number; text: string }[] = [];
  db.exec("BEGIN");
  for (const d of docs) {
    const hit = cache.get(hashOf(d));
    if (hit) {
      for (const h of hit) insVec.run(d.id, h.chunk, h.vec);
      reused++;
    } else {
      chunksOf(d).forEach((text, chunk) => pending.push({ id: d.id, chunk, text }));
      computed++;
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < pending.length; i += 8) {
    const batch = pending.slice(i, i + 8);
    const vecs = await emb.embed(batch.map((b) => b.text));
    batch.forEach((b, j) => insVec.run(b.id, b.chunk, new Uint8Array(vecs[j].buffer)));
    if (pending.length > 50 && (i / 8) % 10 === 0)
      process.stdout.write(`\r  向量 ${Math.min(i + 8, pending.length)}/${pending.length}`);
  }
  if (pending.length > 50)
    process.stdout.write(
      `\n  新算 ${pending.length} 段，用时 ${((performance.now() - t0) / 1000).toFixed(1)} s\n`,
    );
  db.exec("COMMIT");
}

const setMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
setMeta.run("built_at", new Date().toISOString());
setMeta.run("model", withVectors ? "bge-small-zh-v1.5 int8" : "");
setMeta.run("model_hash", withVectors ? modelHash : "");
setMeta.run("docs", String(docs.length));
db.exec("VACUUM");
db.close();
renameSync(tmp, OUT);

console.log(
  `${OUT}：${laws.length} 部法规，${laws.reduce((n, l) => n + l.articles.length, 0)} 条，` +
    `${caseFiles.reduce((n, c) => n + c.cases.length, 0)} 个案例，检索单元 ${docs.length} 个；` +
    (withVectors ? `向量沿用 ${reused}、新算 ${computed}` : "未生成向量"),
);
