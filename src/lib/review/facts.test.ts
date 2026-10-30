// 抽取结果的程序检查：出处过滤、重复归类合并、给自检看的字段说明。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dropUnsourced, fieldGuide, reconcile, type Facts } from "./facts.ts";
import { SAMPLE_FACTS } from "./sample-facts.ts";

const LABOR = readFileSync("data/samples/labor.md", "utf8");
const labor = SAMPLE_FACTS.labor;

describe("出处过滤", () => {
  it("quote 是空的、或者合同里没有的字段去掉，其余原样保留", () => {
    const f: Facts = {
      ...labor,
      nonCompete: { ...labor.nonCompete!, src: { clause: null, quote: "" } },
      deposits: [{ kind: "deposit", amount: 500, src: { clause: null, quote: "缴纳押金 500 元" } }],
    };
    const r = dropUnsourced(f, LABOR);
    expect(r.facts.nonCompete).toBeNull();
    expect(r.facts.deposits).toEqual([]);
    expect(r.facts.probation).toEqual(labor.probation);
    expect(r.dropped.map((d) => d.field).sort()).toEqual(["deposits", "nonCompete"]);
  });

  it("空格、全角半角不同不算找不到", () => {
    const f: Facts = {
      ...labor,
      probation: { ...labor.probation!, src: { clause: "第三条", quote: "其中试用期３个月" } },
    };
    expect(dropUnsourced(f, LABOR).facts.probation).not.toBeNull();
  });
});

describe("重复归类", () => {
  it("others 里和规则字段同一处的去掉", () => {
    const f: Facts = {
      ...labor,
      others: [
        {
          concern: "提前离职要付违约金",
          src: { clause: "第七条", quote: "应向甲方支付违约金人民币 20000 元" },
        },
        {
          concern: "社保个人部分从工资扣",
          src: { clause: "第六条", quote: "个人应缴部分由甲方从乙方工资中代扣代缴" },
        },
      ],
    };
    const r = reconcile(f);
    expect(r.facts.others.map((o) => o.src.clause)).toEqual(["第六条"]);
    expect(r.merged).toHaveLength(1);
  });

  it("termination 和 resignation 是同一处时去掉 termination：辞职条款不是单位的解除条件", () => {
    const f: Facts = {
      ...labor,
      termination: [
        {
          kind: "other",
          src: {
            clause: "第十一条",
            quote:
              "按《中华人民共和国劳动合同法》的有关规定执行。乙方提前三十日以书面形式通知甲方，可以解除本合同",
          },
        },
      ],
    };
    expect(reconcile(f).facts.termination).toEqual([]);
  });
});

describe("字段说明", () => {
  it("取自抽取结构的说明，含枚举值的意思；可为空的字段也有总说明", () => {
    expect(fieldGuide("nonCompete")).toMatch(/^竞业限制/);
    expect(fieldGuide("nonCompete")).toContain("none 没有约定");
    expect(fieldGuide("probationOnly")).toContain("先签试用期合同");
    expect(fieldGuide("penalty")).toContain("early_resign 提前离职");
    expect(fieldGuide("没有这个字段")).toBe("");
  });
});
