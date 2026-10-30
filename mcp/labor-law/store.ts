// 法规库读取：按 ID 取原文、全文检索、向量检索、两路合并。
// 库文件由 scripts/corpus/build-db.ts 生成。只读打开，网站和 MCP 服务可以同时用。

import { DatabaseSync } from "node:sqlite";
import { bigrams } from "./text.ts";

export type ArticleRow = {
  id: string;
  law_id: string;
  law_title: string;
  law_short: string;
  no: number;
  label: string;
  chapter: string | null;
  text: string;
  source_url: string;
  version: string;
};
export type ParagraphRow = {
  id: string;
  article_id: string;
  no: number;
  text: string;
  status: string | null;
  note: string | null;
};
export type Hit = { id: string; kind: string; title: string; score: number };

export class LawStore {
  readonly db: DatabaseSync;
  private vectors: { docId: string; vec: Float32Array }[] | null = null;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
  }

  meta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  /** 条文 ID（ldhtf-19）或款 ID（ldhtf-19-1）都能查；款 ID 额外返回这一款 */
  getArticle(
    id: string,
  ): { article: ArticleRow; paragraphs: ParagraphRow[]; paragraph?: ParagraphRow } | null {
    const para = this.db.prepare("SELECT * FROM paragraphs WHERE id = ?").get(id) as
      ParagraphRow | undefined;
    const articleId = para ? para.article_id : id;
    const article = this.db
      .prepare(
        `SELECT a.*, l.title AS law_title, l.short AS law_short, l.source_url, l.version
         FROM articles a JOIN laws l ON l.id = a.law_id WHERE a.id = ?`,
      )
      .get(articleId) as ArticleRow | undefined;
    if (!article) return null;
    const paragraphs = this.db
      .prepare("SELECT * FROM paragraphs WHERE article_id = ? ORDER BY no")
      .all(articleId) as ParagraphRow[];
    return { article, paragraphs, paragraph: para };
  }

  /** 全文检索：查询按同样的二字切分，各词之间是"或"，按 BM25 排序 */
  searchText(query: string, k = 20): Hit[] {
    const terms = [...new Set(bigrams(query).split(" ").filter(Boolean))];
    if (terms.length === 0) return [];
    // 每个词加引号，避免用户输入里的 AND、NOT、括号被当成检索语法
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT f.id, d.kind, d.title, bm25(docs_fts) AS rank
         FROM docs_fts f JOIN docs d ON d.id = f.id
         WHERE docs_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, k) as { id: string; kind: string; title: string; rank: number }[];
    // bm25() 越小越相关，取负数让分数越大越好
    return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, score: -r.rank }));
  }

  /** 向量检索：第一次调用时把全部向量读进内存（几百条，约 1MB），之后每次全量算点积 */
  searchVector(q: Float32Array, k = 20): Hit[] {
    if (!this.vectors) {
      const rows = this.db.prepare("SELECT doc_id, vec FROM vectors").all() as {
        doc_id: string;
        vec: Uint8Array;
      }[];
      // BLOB 读出来的字节不一定按 4 字节对齐，复制一份再当 Float32Array 用
      this.vectors = rows.map((r) => ({
        docId: r.doc_id,
        vec: new Float32Array(r.vec.slice().buffer),
      }));
    }
    const best = new Map<string, number>();
    for (const { docId, vec } of this.vectors) {
      let s = 0;
      for (let i = 0; i < vec.length; i++) s += vec[i] * q[i];
      // 长条文切成了几段，取最像的一段
      if (s > (best.get(docId) ?? -Infinity)) best.set(docId, s);
    }
    const top = [...best].sort((a, b) => b[1] - a[1]).slice(0, k);
    const info = this.db.prepare("SELECT kind, title FROM docs WHERE id = ?");
    return top.map(([id, score]) => ({
      id,
      ...(info.get(id) as { kind: string; title: string }),
      score,
    }));
  }

  /** 检索单元的全文（法条一条，或案例的一段），search_law 返回结果时用 */
  getDoc(id: string): { id: string; kind: string; title: string; text: string } | undefined {
    return this.db.prepare("SELECT id, kind, title, text FROM docs WHERE id = ?").get(id) as
      { id: string; kind: string; title: string; text: string } | undefined;
  }

  get hasVectors(): boolean {
    return (this.db.prepare("SELECT count(*) AS n FROM vectors").get() as { n: number }).n > 0;
  }

  close() {
    this.db.close();
  }
}

/** RRF 合并：每一路按名次给分 1/(60+名次)，加总后排序。两路分数量纲不同，只看名次 */
export function rrf(lists: Hit[][], k = 20, c = 60): Hit[] {
  const acc = new Map<string, Hit>();
  for (const list of lists)
    list.forEach((h, rank) => {
      const prev = acc.get(h.id);
      const add = 1 / (c + rank + 1);
      acc.set(h.id, prev ? { ...prev, score: prev.score + add } : { ...h, score: add });
    });
  return [...acc.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
