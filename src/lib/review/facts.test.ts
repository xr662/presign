// 抽取结果的程序检查：出处过滤、重复归类合并、给自检看的字段说明。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amountInQuote,
  dropUnquotedAmounts,
  dropUnquotedDeduction,
  dropUnquotedRole,
  dropUnsourced,
  fieldGuide,
  fillRequiredClauses,
  reconcile,
  rescueRuleClauses,
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

describe("漏抽的违约金、押金和证件按原文补上", () => {
  const OFFER = readFileSync("data/samples/offer.md", "utf8");
  const INTERNSHIP = readFileSync("data/samples/internship.md", "utf8");
  const none: Facts = {
    ...labor,
    penalties: [],
    deposits: [],
    servicePeriod: null,
    nonCompete: null,
  };

  it("劳动合同的违约金没进字段时补上，金额和条款号取自那一句", () => {
    const r = rescueRuleClauses(none, LABOR);
    const p = r.facts.penalties.find((x) => x.src.quote.includes("20000"));
    expect(p).toMatchObject({ party: "worker", trigger: "early_resign", amount: 20000 });
    expect(p?.src.clause).toBe("第七条");
    expect(r.added.some((a) => a.field === "penalties")).toBe(true);
  });

  it("已经在字段里的不重复补", () => {
    expect(rescueRuleClauses(labor, LABOR).facts.penalties).toEqual(labor.penalties);
  });

  it("单位付、带否定词、服务期竞业限制的违约金不补；三方协议、录用通知不补违约金", () => {
    const text = [
      "第八条 违约责任",
      "甲方违法解除本合同的，应向乙方支付违约金 5000 元。",
      "甲方不得要求乙方支付违约金。",
      "乙方服务期未满离职的，应向甲方支付违约金 8000 元。",
      "乙方违反竞业限制约定的，应向甲方支付违约金 10 万元。",
    ].join("\n");
    expect(rescueRuleClauses(none, text).facts.penalties).toEqual([]);
    const tri: Facts = { ...none, docKind: "三方协议" };
    expect(
      rescueRuleClauses(tri, "乙方不按时报到的，向甲方支付违约金 10000 元。").facts.penalties,
    ).toEqual([]);
  });

  it("写成万元、触发条件按句子里的词归类", () => {
    const r = rescueRuleClauses(none, "乙方试用期内离职的，须向甲方支付违约金 1.5 万元。");
    expect(r.facts.penalties[0]).toMatchObject({ trigger: "probation_resign", amount: 15000 });
  });

  it("证件原件交单位保管补成扣证件；只带原件核验、当场归还的不补", () => {
    const r = rescueRuleClauses({ ...none, docKind: "录用通知" }, OFFER);
    expect(r.facts.deposits).toHaveLength(1);
    expect(r.facts.deposits[0]).toMatchObject({ kind: "keep_original_certificate", amount: null });
    expect(r.facts.deposits[0].src.quote).toContain("统一保管");
    expect(r.facts.deposits[0].src.clause).toBe("五");
    const check = rescueRuleClauses(none, "入职时携带毕业证原件供核验，核验后当场归还。");
    expect(check.facts.deposits).toEqual([]);
  });

  it("押金补成押金，带上金额；不收取押金的句子不补", () => {
    const r = rescueRuleClauses({ ...none, docKind: "实习协议" }, INTERNSHIP);
    expect(r.facts.deposits).toEqual([expect.objectContaining({ kind: "deposit", amount: 500 })]);
    expect(rescueRuleClauses(none, "甲方不收取乙方任何押金。").facts.deposits).toEqual([]);
  });

  it("补进来的句子在合同里找得到，过得了出处检查", () => {
    const r = rescueRuleClauses(none, LABOR);
    expect(dropUnsourced(r.facts, LABOR).dropped).toEqual([]);
  });
});

describe("必备条款按关键词补成有", () => {
  it("模型给 null、原文能认出 6 项以上时补上；关键词认不出的项保持没有", () => {
    const r = fillRequiredClauses({ ...labor, requiredClauses: null }, LABOR);
    expect(r.facts.requiredClauses).not.toBeNull();
    expect(r.filled.length).toBeGreaterThanOrEqual(6);
  });

  it("模型全填 false 时，关键词认出的项改成有", () => {
    const allFalse = Object.fromEntries(
      Object.keys(labor.requiredClauses!).map((k) => [k, false]),
    ) as NonNullable<Facts["requiredClauses"]>;
    const r = fillRequiredClauses({ ...labor, requiredClauses: allFalse }, LABOR);
    expect(r.facts.requiredClauses?.pay).toBe(true);
    expect(r.facts.requiredClauses?.social_insurance).toBe(true);
  });

  it("模型给 null、只有一页的片段不补；不是劳动合同不动", () => {
    const page = "第四条 劳动报酬\n乙方月工资 8000 元。";
    expect(
      fillRequiredClauses({ ...labor, requiredClauses: null }, page).facts.requiredClauses,
    ).toBeNull();
    const offer: Facts = { ...labor, docKind: "录用通知", requiredClauses: null };
    expect(fillRequiredClauses(offer, LABOR).facts.requiredClauses).toBeNull();
  });
});

describe("辞职扣钱必须写在辞职这一条里", () => {
  const resign = (quote: string, penaltyOrDeduction = true): Facts => ({
    ...labor,
    resignation: {
      noticeDays: 30,
      probationNoticeDays: null,
      needsApproval: false,
      penaltyOrDeduction,
      src: { clause: "第十一条", quote },
    },
  });

  it("原文里没有扣钱、赔钱字样的改成不扣钱", () => {
    const r = dropUnquotedDeduction(resign("乙方提前三十日以书面形式通知甲方，可以解除本合同"));
    expect(r.cleared).toBe(true);
    expect(r.facts.resignation?.penaltyOrDeduction).toBe(false);
  });

  it("原文写了扣发、违约金的保留", () => {
    for (const q of ["未经批准擅自离开的，扣发当月实习补贴", "辞职须支付违约金 5000 元"])
      expect(dropUnquotedDeduction(resign(q)).cleared).toBe(false);
  });

  it("本来就是不扣钱的不动", () => {
    const f = resign("乙方提前三十日以书面形式通知甲方，可以解除本合同", false);
    expect(dropUnquotedDeduction(f).facts).toBe(f);
  });
});

describe("落户换服务期和服务期是同一条时按落户算", () => {
  const tri = SAMPLE_FACTS.tripartite;
  const src = { clause: "四", quote: "甲方为乙方办理苏州市落户手续。乙方须在甲方服务满 5 年" };
  const sp = {
    trainingKind: "unknown" as const,
    trainingCost: null,
    serviceMonths: 60,
    penalty: { kind: "amount" as const, amount: 50000 },
    src: { clause: "四", quote: "未满 5 年离职的，向甲方支付违约金 50000 元" },
  };
  const sb = { benefit: "hukou" as const, serviceYears: 5, amount: 50000, src };

  it("同一条款号、服务期没写培训费：去掉服务期", () => {
    const f = { ...tri, servicePeriod: sp, specialBenefit: sb } as Facts;
    const r = reconcile(f);
    expect(r.facts.servicePeriod).toBeNull();
    expect(r.merged.some((m) => m.field === "servicePeriod")).toBe(true);
  });

  it("服务期写了培训费的保留", () => {
    const f = {
      ...tri,
      servicePeriod: { ...sp, trainingCost: 12000 },
      specialBenefit: sb,
    } as Facts;
    expect(reconcile(f).facts.servicePeriod).not.toBeNull();
  });
});

describe("竞业限制的岗位必须是原文里的字", () => {
  it("原文里没有的岗位改成空，有的保留", () => {
    const nc = labor.nonCompete!;
    const bad = { ...labor, nonCompete: { ...nc, role: "worker" } };
    expect(dropUnquotedRole(bad, LABOR).nonCompete?.role).toBeNull();
    const good = { ...labor, nonCompete: { ...nc, role: "软件开发工程师" } };
    expect(dropUnquotedRole(good, LABOR).nonCompete?.role).toBe("软件开发工程师");
  });
});
