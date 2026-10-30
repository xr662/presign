// 混合检索：一组查询（原句 + 改写），每个查询各走全文和向量两路，所有名单一起做 RRF。
// MCP 服务的 search_law 和评测脚本都调这里，评测测到的就是线上用的那段代码。

import { rrf, type Hit, type LawStore } from "./store.ts";

export type Embedder = { embedQuery(q: string): Promise<Float32Array> };

export type SearchHit = Hit & {
  text: string;
  // 每一路里的名次（从 1 开始），没进这一路前 perList 名的不记。评测和检查记录里用来解释"为什么排在这里"
  ranks: { list: string; rank: number }[];
};

export type SearchOptions = {
  // 每一路取前几名参与合并。T03 抽查时前 20 名已能覆盖向量补回的条文
  perList?: number;
  k?: number;
  // 只用某一路，评测对照用
  only?: "text" | "vector";
};

export async function hybridSearch(
  store: LawStore,
  embedder: Embedder | null,
  queries: string[],
  { perList = 20, k = 8, only }: SearchOptions = {},
): Promise<SearchHit[]> {
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  const lists: { name: string; hits: Hit[] }[] = [];
  const useVector = only !== "text" && embedder !== null && store.hasVectors;
  for (const [i, q] of qs.entries()) {
    if (only !== "vector") lists.push({ name: `text#${i}`, hits: store.searchText(q, perList) });
    if (useVector)
      lists.push({
        name: `vector#${i}`,
        hits: store.searchVector(await embedder.embedQuery(q), perList),
      });
  }
  return rrf(
    lists.map((l) => l.hits),
    k,
  ).map((h) => ({
    ...h,
    text: store.getDoc(h.id)?.text ?? "",
    ranks: lists.flatMap((l) => {
      const r = l.hits.findIndex((x) => x.id === h.id);
      return r < 0 ? [] : [{ list: l.name, rank: r + 1 }];
    }),
  }));
}
