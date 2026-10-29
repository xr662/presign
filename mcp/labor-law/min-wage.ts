// 最低工资查询：规则 R04（试用期工资不得低于当地最低工资）用。
// 数据是 data/clean/wage/min_wage.json，由 scripts/corpus/min-wage.ts 生成。
// 城市在表里就直接给出档位和金额；不在表里、或档位还没核实的，返回该省各档，让用户自己选，
// 不替用户猜档位（同一个城市的市区和下辖县经常不在一档，比如合肥市区一档、肥东三档）。

import { readFileSync } from "node:fs";

type Tier = { monthly: number; hourly: number };
type Data = {
  asOf: string;
  original: { url: string; verifiedAgainstOriginal: boolean };
  provinces: { province: string; tiers: Tier[]; doc?: string; url: string }[];
  special: ({ city: string; province: string; url: string } & Tier)[];
  cities: {
    city: string;
    province: string;
    tier: number;
    doc: string;
    url: string;
    note?: string;
  }[];
  pendingCities: { city: string; province: string; reason: string }[];
};

export type MinWage =
  | {
      kind: "found";
      province: string;
      city?: string;
      tier: number;
      monthly: number;
      hourly: number;
      doc: string;
      url: string;
      note?: string;
      asOf: string;
    }
  | { kind: "need_tier"; province: string; tiers: Tier[]; reason: string; asOf: string }
  | { kind: "unknown"; reason: string };

let cache: Data | null = null;
function load(path = "data/clean/wage/min_wage.json"): Data {
  cache ??= JSON.parse(readFileSync(path, "utf8")) as Data;
  return cache;
}

// "上海市""广西壮族自治区""深圳市"统一成表里的写法
const clean = (s: string) =>
  s
    .trim()
    .replace(/(壮族|回族|维吾尔)?自治区$|省$|特别行政区$/u, "")
    .replace(/市$/u, "");

export function minWageFor(
  q: { city?: string; province?: string; tier?: number },
  path?: string,
): MinWage {
  const d = load(path);
  const city = q.city ? clean(q.city) : undefined;
  const base = { asOf: d.asOf };

  if (city) {
    const sp = d.special.find((s) => s.city === city);
    if (sp)
      return {
        kind: "found",
        ...base,
        province: sp.province,
        city,
        tier: 1,
        monthly: sp.monthly,
        hourly: sp.hourly,
        doc: "单列标准",
        url: sp.url,
      };
    const c = d.cities.find((x) => x.city === city);
    if (c && q.tier === undefined) {
      const t = d.provinces.find((p) => p.province === c.province)!.tiers[c.tier - 1];
      return {
        kind: "found",
        ...base,
        province: c.province,
        city,
        tier: c.tier,
        ...t,
        doc: c.doc,
        url: c.url,
        note: c.note,
      };
    }
    const pending = d.pendingCities.find((x) => x.city === city);
    if (pending && q.tier === undefined) {
      const p = d.provinces.find((x) => x.province === pending.province)!;
      return {
        kind: "need_tier",
        ...base,
        province: p.province,
        tiers: p.tiers,
        reason: pending.reason,
      };
    }
  }

  const provName = q.province
    ? clean(q.province)
    : city && d.cities.find((x) => x.city === city)?.province;
  const p = provName ? d.provinces.find((x) => x.province === provName) : undefined;
  if (!p) return { kind: "unknown", reason: "没有找到这个城市所在的省份，需要用户选择省份和档位" };
  if (p.tiers.length === 1 || q.tier !== undefined) {
    const n = q.tier ?? 1;
    const t = p.tiers[n - 1];
    if (!t)
      return {
        kind: "need_tier",
        ...base,
        province: p.province,
        tiers: p.tiers,
        reason: `${p.province}只有 ${p.tiers.length} 档`,
      };
    return {
      kind: "found",
      ...base,
      province: p.province,
      city,
      tier: n,
      ...t,
      doc: p.doc ?? "人社部全国最低工资标准表",
      url: p.url,
    };
  }
  return {
    kind: "need_tier",
    ...base,
    province: p.province,
    tiers: p.tiers,
    reason: "这个城市的档位不在表里，需要用户选择",
  };
}
