// 示例合同和标准答案的一致性：答案里引用的原文必须真的在合同里，规则编号和结论等级必须是规则清单里有的。
// 改了合同文字忘了改答案，这里会失败。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minWageFor } from "./min-wage.ts";

type Answers = {
  samples: {
    id: string;
    file: string;
    workPlace: { province: string; city: string };
    findings: { rule: string; verdict: string; quote: string }[];
  }[];
};
const answers = JSON.parse(readFileSync("data/samples/answers.json", "utf8")) as Answers;
const P0 = [
  "R01",
  "R02",
  "R03",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
];
const VERDICTS = ["violation", "likely_violation", "needs_review", "advice", "ok", "unknown"];

describe("示例合同", () => {
  it("四份都在", () => {
    expect(answers.samples.map((s) => s.id).sort()).toEqual([
      "internship",
      "labor",
      "offer",
      "tripartite",
    ]);
  });

  for (const s of answers.samples) {
    const text = readFileSync(`data/samples/${s.file}`, "utf8");
    describe(s.id, () => {
      it.each(s.findings.map((f) => [f.rule, f.quote, f.verdict] as const))(
        "%s 引用的原文在合同里：%s",
        (rule, quote, verdict) => {
          expect(text).toContain(quote);
          expect(P0).toContain(rule);
          expect(VERDICTS).toContain(verdict);
        },
      );
      it("标明虚构", () => {
        expect(text).toMatch(/虚构示例/);
      });
      it("身份证号校验位是错的，不会是真实号码", () => {
        const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
        for (const id of text.match(/\d{17}[\dX]/g) ?? []) {
          const sum = [...id.slice(0, 17)].reduce((a, c, i) => a + Number(c) * w[i], 0);
          expect("10X98765432"[sum % 11]).not.toBe(id[17]);
        }
      });
      it("工作地点能查到最低工资", () => {
        expect(minWageFor(s.workPlace).kind).toBe("found");
      });
    });
  }

  it("录用通知的试用期工资低于上海最低工资（R05 的 violation 用例要成立）", () => {
    const sh = minWageFor({ city: "上海" });
    expect(sh.kind === "found" && sh.monthly > 2600).toBe(true);
  });
});
