// 法规库读取测试：现建一个不带向量的库（几秒），测按 ID 取原文和全文检索。向量检索的效果在 bench-embed 里看。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LawStore, rrf } from "./store.ts";

let dir: string;
let store: LawStore;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lawdb-"));
  execFileSync(process.execPath, [
    "scripts/corpus/build-db.ts",
    "--no-vectors",
    "--out",
    join(dir, "law.db"),
  ]);
  store = new LawStore(join(dir, "law.db"));
}, 60_000);
afterAll(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("按 ID 取原文", () => {
  it("款 ID 返回这一款和整条", () => {
    const r = store.getArticle("ldhtf-19-1")!;
    expect(r.article.law_short).toBe("劳动合同法");
    expect(r.article.label).toBe("第十九条");
    expect(r.paragraph?.text).toMatch(/^劳动合同期限三个月以上不满一年的/);
    expect(r.paragraphs).toHaveLength(4);
    expect(r.article.source_url).toMatch(/^https?:\/\//);
  });
  it("不存在的 ID 返回 null", () => {
    expect(store.getArticle("ldhtf-999")).toBeNull();
  });
  it("已废止的款带说明", () => {
    expect(store.getArticle("ldzy-js1-32-1")!.paragraph?.note).toMatch(/法释〔2025〕12号/);
  });
});

describe("全文检索", () => {
  it("用法条原话能查到对应条文", () => {
    expect(store.searchText("试用期不得超过", 3)[0].id).toBe("ldhtf-19");
    expect(store.searchText("扣押劳动者的居民身份证", 3)[0].id).toBe("ldhtf-9");
  });
  it("两个字的词也能查到（trigram 分词查不到的情况）", () => {
    expect(
      store.searchText("押金", 50).length + store.searchText("违约金", 50).length,
    ).toBeGreaterThan(0);
  });
  it("检索语法字符不会报错", () => {
    expect(() => store.searchText('试用期" OR NOT (', 5)).not.toThrow();
  });
  it("案例也能查到", () => {
    expect(store.searchText("混同用工", 5).some((h) => h.kind === "case")).toBe(true);
  });
});

describe("RRF 合并", () => {
  it("两路都靠前的排第一", () => {
    const a = [
      { id: "x", kind: "article", title: "", score: 1 },
      { id: "y", kind: "article", title: "", score: 0.5 },
    ];
    const b = [
      { id: "y", kind: "article", title: "", score: 1 },
      { id: "x", kind: "article", title: "", score: 0.5 },
      { id: "z", kind: "article", title: "", score: 0.1 },
    ];
    const m = rrf([a, b]);
    expect(
      m
        .map((h) => h.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(["x", "y"]);
    expect(m.at(-1)!.id).toBe("z");
  });
});
