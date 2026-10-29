// 生成最低工资表 data/clean/wage/min_wage.json。
// 底表是人社部截至 1 月 1 日的全国表（政府网站 HTML 转载），按 data/min-wage-sources.json 里的
// 省级调整文件逐省替换，得到截至 asOf 的表。每个省记下数字出自底表还是哪份调整文件。
// 用法：node scripts/corpus/min-wage.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeHtml } from "../../mcp/labor-law/text.ts";

type Tier = { monthly: number; hourly: number };
type Adjustment = {
  province: string;
  doc: string;
  effective: string;
  tiers: Tier[];
  special?: ({ city: string } & Tier)[];
  url: string;
  publisher: string;
  note?: string;
};
type Cfg = {
  asOf: string;
  original: { title: string; url: string; verifiedAgainstOriginal: boolean };
  base: { title: string; asOf: string; url: string; publisher: string };
  adjustments: Adjustment[];
  cities: {
    city: string;
    province: string;
    tier: number;
    doc: string;
    url: string;
    note?: string;
  }[];
  pendingCities?: { city: string; province: string; reason: string }[];
};

const cfg = JSON.parse(readFileSync("data/min-wage-sources.json", "utf8")) as Cfg;
const RAW = "data/raw/min-wage/base.html";

if (!existsSync(RAW)) {
  mkdirSync("data/raw/min-wage", { recursive: true });
  const res = await fetch(cfg.base.url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130" },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`底表下载失败：HTTP ${res.status}`);
  writeFileSync(RAW, new Uint8Array(await res.arrayBuffer()));
}

// 人社部的表：地区 | 月标准 4 档 | 小时标准 4 档；空格是 &ensp;。"其中：深圳"单独一行。
// 底表和人工另存的原表都用这个函数解析
function tableRows(file: string): string[][] {
  const html = decodeHtml(readFileSync(file));
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
    .map((m) => m[0])
    .find((t) => t.includes("月最低工资标准"));
  if (!table) throw new Error(`${file} 里没有找到最低工资表格`);
  return [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
    [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&\w+;|\s/g, "")
        .trim(),
    ),
  );
}
// 每行压成"地区:月1/小时1,月2/小时2"，和原表逐行比较
const rowKey = (r: string[]) => {
  const m = r.slice(1, 5).filter(Boolean);
  const h = r.slice(5, 9).filter(Boolean);
  return `${r[0].replace("其中：", "")}:${m.map((x, i) => `${Number(x)}/${Number(h[i])}`).join(",")}`;
};
const rows = tableRows(RAW);

type Province = {
  province: string;
  tiers: Tier[];
  source: string;
  doc?: string;
  effective?: string;
  url: string;
};
const provinces: Province[] = [];
const special: ({ city: string; province: string; source: string; url: string } & Tier)[] = [];
for (const r of rows) {
  if (r.length < 9 || !/^\d/.test(r[1])) continue;
  const monthly = r.slice(1, 5).filter(Boolean).map(Number);
  const hourly = r.slice(5, 9).filter(Boolean).map(Number);
  if (monthly.length !== hourly.length) throw new Error(`${r[0]} 月标准和小时标准档数不同`);
  const tiers = monthly.map((m, i) => ({ monthly: m, hourly: hourly[i] }));
  if (r[0].startsWith("其中")) {
    special.push({
      city: r[0].replace("其中：", ""),
      province: provinces.at(-1)!.province,
      ...tiers[0],
      source: "base",
      url: cfg.base.url,
    });
  } else {
    provinces.push({ province: r[0], tiers, source: "base", url: cfg.base.url });
  }
}
if (provinces.length !== 31)
  throw new Error(`底表应有 31 个省级行政区，解析出 ${provinces.length} 个`);

for (const a of cfg.adjustments) {
  if (a.effective > cfg.asOf) continue;
  const p = provinces.find((x) => x.province === a.province);
  if (!p) throw new Error(`调整文件里的省份不在底表中：${a.province}`);
  Object.assign(p, {
    tiers: a.tiers,
    source: "adjustment",
    doc: a.doc,
    effective: a.effective,
    url: a.url,
  });
  for (const s of a.special ?? []) {
    const old = special.find((x) => x.city === s.city);
    const row = { ...s, province: a.province, source: "adjustment", url: a.url };
    if (old) Object.assign(old, row);
    else special.push(row);
  }
}

for (const p of provinces)
  for (let i = 1; i < p.tiers.length; i++)
    if (p.tiers[i].monthly >= p.tiers[i - 1].monthly)
      throw new Error(`${p.province} 的档位不是从高到低`);
for (const c of cfg.cities) {
  const p = provinces.find((x) => x.province === c.province);
  if (!p || c.tier < 1 || c.tier > p.tiers.length)
    throw new Error(`${c.city} 的档位 ${c.tier} 在 ${c.province} 不存在`);
}

// 人社部原表：官网有反爬验证，程序取不到。人工在浏览器里打开原表页面，
// 另存为 data/raw/min-wage/original.html 后，这里逐行比较，全部一致才标记为已核对。
const ORIGINAL = "data/raw/min-wage/original.html";
let verified = cfg.original.verifiedAgainstOriginal;
if (existsSync(ORIGINAL)) {
  const want = tableRows(ORIGINAL)
    .filter((r) => r.length >= 9 && /^\d/.test(r[1]))
    .map(rowKey);
  const got = [
    ...provinces.map(
      (p) => `${p.province}:${p.tiers.map((t) => `${t.monthly}/${t.hourly}`).join(",")}`,
    ),
    ...special.map((sp) => `${sp.city}:${sp.monthly}/${sp.hourly}`),
  ];
  const diff = [...want.filter((w) => !got.includes(w)), ...got.filter((g) => !want.includes(g))];
  if (want.length === 0) throw new Error("原表页面里没有解析出数据行");
  if (diff.length) {
    console.log(`× 与人社部原表不一致：\n  ${diff.join("\n  ")}`);
    process.exitCode = 1;
  }
  verified = diff.length === 0;
}

mkdirSync("data/clean/wage", { recursive: true });
const out = {
  asOf: cfg.asOf,
  note: "月标准适用于全日制劳动者，小时标准适用于非全日制劳动者（最低工资规定第五条）。",
  original: { ...cfg.original, verifiedAgainstOriginal: verified },
  base: cfg.base,
  provinces,
  special,
  cities: cfg.cities,
  pendingCities: cfg.pendingCities ?? [],
};
writeFileSync("data/clean/wage/min_wage.json", JSON.stringify(out, null, 2) + "\n");
const changed = provinces.filter((p) => p.source === "adjustment").map((p) => p.province);
console.log(
  `最低工资表：${provinces.length} 个省级行政区，单列城市 ${special.map((s) => s.city).join("、")}；` +
    `按调整文件更新 ${changed.join("、")}；城市档位 ${cfg.cities.length} 个；` +
    `与人社部原表核对：${verified ? "已核对" : "未核对（见 data/min-wage-sources.json 开头的说明）"}`,
);
