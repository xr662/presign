import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minWageFor } from "./min-wage.ts";

const data = JSON.parse(readFileSync("data/clean/wage/min_wage.json", "utf8")) as {
  asOf: string;
  provinces: { province: string; tiers: { monthly: number }[] }[];
  cities: { city: string; province: string; tier: number; doc: string; url: string }[];
};

describe("最低工资表", () => {
  it("31 个省级行政区，截至 2026-10-01", () => {
    expect(data.provinces).toHaveLength(31);
    expect(data.asOf).toBe("2026-10-01");
  });
  it("每个城市都写明了出自哪份文件", () => {
    for (const c of data.cities) {
      expect(c.doc, c.city).toBeTruthy();
      expect(c.url, c.city).toMatch(/^https?:\/\/[^/]*gov\.cn\//);
    }
  });
  it("至少 40 个常见城市有档位", () => {
    expect(data.cities.length).toBeGreaterThanOrEqual(40);
  });
});

describe("查询", () => {
  it("已知数对得上：上海 2740，北京 2540", () => {
    expect(minWageFor({ city: "上海市" })).toMatchObject({
      kind: "found",
      monthly: 2740,
      hourly: 25,
    });
    expect(minWageFor({ city: "北京" })).toMatchObject({
      kind: "found",
      monthly: 2540,
      hourly: 27.7,
    });
  });
  it("深圳单列，比广东一档高", () => {
    expect(minWageFor({ city: "深圳" })).toMatchObject({ monthly: 2700 });
    expect(minWageFor({ city: "广州" })).toMatchObject({ monthly: 2680, tier: 1 });
  });
  it("省会不一定是第一档：福州是福建第二档", () => {
    expect(minWageFor({ city: "福州" })).toMatchObject({ kind: "found", tier: 2, monthly: 2195 });
  });
  it("10 月 1 日前生效的调整已经算进去：山西 2350，新疆 2270", () => {
    expect(minWageFor({ city: "太原" })).toMatchObject({ monthly: 2350 });
    expect(minWageFor({ province: "新疆维吾尔自治区", tier: 1 })).toMatchObject({ monthly: 2270 });
  });
  it("档位没核实的城市不猜，让用户选", () => {
    const r = minWageFor({ city: "石家庄" });
    expect(r.kind).toBe("need_tier");
    if (r.kind === "need_tier") expect(r.tiers.map((t) => t.monthly)).toEqual([2380, 2230, 2080]);
  });
  it("不在表里的城市给出省份各档", () => {
    expect(minWageFor({ city: "绵阳", province: "四川省" })).toMatchObject({
      kind: "need_tier",
      province: "四川",
    });
    expect(minWageFor({ city: "绵阳", province: "四川", tier: 2 })).toMatchObject({
      kind: "found",
      monthly: 2200,
    });
  });
  it("单档省份不用选", () => {
    expect(minWageFor({ province: "青海" })).toMatchObject({ kind: "found", monthly: 2080 });
  });
  it("省份也不知道时返回 unknown", () => {
    expect(minWageFor({ city: "某县" }).kind).toBe("unknown");
  });
  it("选了不存在的档位", () => {
    expect(minWageFor({ province: "北京", tier: 3 }).kind).toBe("need_tier");
  });
});
