// 抽取结果的程序检查：出处过滤、重复归类合并、给自检看的字段说明。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amountInQuote,
  dropUnquotedAmounts,
  dropUnsourced,
  fieldGuide,
  reconcile,
  type Facts,
} from "./facts.ts";
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

describe("金额必须出自这一项的原文", () => {
  it("认 20000、20,000、2 万、全角数字几种写法", () => {
    expect(amountInQuote(20000, "应向甲方支付违约金人民币 20000 元")).toBe(true);
    expect(amountInQuote(20000, "违约金 20,000 元")).toBe(true);
    expect(amountInQuote(20000, "违约金 2 万元")).toBe(true);
    expect(amountInQuote(15000, "违约金1.5万元")).toBe(true);
    expect(amountInQuote(500, "工服押金５００元")).toBe(true);
    expect(amountInQuote(3000, "未经批准擅自离开的，扣发当月实习补贴")).toBe(false);
  });

  it("金额对不上的置空并记下来，这一项本身保留；对得上的不动", () => {
    // 10-31 评测里实习协议的情形：3000 是另一条的月补贴
    const f: Facts = {
      ...labor,
      penalties: [
        ...labor.penalties,
        {
          party: "worker",
          trigger: "breach_tripartite",
          amount: 3000,
          src: { clause: "五", quote: "未经批准擅自离开的，扣发当月实习补贴" },
        },
      ],
    };
    const r = dropUnquotedAmounts(f);
    expect(r.facts.penalties.at(-1)!.amount).toBeNull();
    expect(r.facts.penalties.at(-1)!.src.quote).toBe("未经批准擅自离开的，扣发当月实习补贴");
    expect(r.facts.penalties.slice(0, -1)).toEqual(labor.penalties);
    expect(r.cleared).toEqual([
      { field: "penalties", quote: "未经批准擅自离开的，扣发当月实习补贴" },
    ]);
  });

  it("四份示例合同的人工字段全部通过，不误清", () => {
    for (const [id, facts] of Object.entries(SAMPLE_FACTS))
      expect(dropUnquotedAmounts(facts).cleared, id).toEqual([]);
  });
});
