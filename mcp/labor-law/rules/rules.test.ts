// 规则测试：规则清单里每条规则下面的测试表逐行写成用例，边界值都在。
// 最后用四份示例合同的字段（人工按合同原文填）跑一遍，和 data/samples/answers.json 的标准答案比。
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reachesMonths } from "./dates.ts";
import { checkNonCompete } from "./non-compete.ts";
import { checkPenalties, checkServicePeriod, checkSpecialBenefitPenalty } from "./penalty.ts";
import { checkProbationForbidden, checkProbationLimit, checkProbationOnly } from "./probation.ts";
import {
  checkDeposit,
  checkRequiredClauses,
  checkResignation,
  checkSocialInsurance,
  checkTerminationConditions,
  checkTripartite,
  checkUnilateralChange,
} from "./terms.ts";
import type { Finding } from "./types.ts";
import { checkProbationWage } from "./wage.ts";

describe("期限计算", () => {
  it("满 N 年：end ≥ start + N 年 − 1 天", () => {
    expect(reachesMonths("2027-07-01", "2029-06-30", 24)).toBe(true);
    expect(reachesMonths("2027-07-01", "2029-06-29", 24)).toBe(false);
    expect(reachesMonths("2027-07-01", "2030-06-30", 36)).toBe(true);
    expect(reachesMonths("2027-07-01", "2030-06-29", 36)).toBe(false);
  });
  it("月末起算：1 月 31 日起满 1 个月是 2 月 27 日（非闰年）", () => {
    expect(reachesMonths("2027-01-31", "2027-02-27", 1)).toBe(true);
    expect(reachesMonths("2027-01-31", "2027-02-26", 1)).toBe(false);
  });
});

describe("R01 试用期上限", () => {
  const fixed = (start: string, end: string) => ({ kind: "fixed" as const, start, end });
  it.each([
    [fixed("2027-07-01", "2029-06-30"), 3, "violation", 2],
    [fixed("2027-07-01", "2030-06-30"), 6, "ok", 6],
    [fixed("2027-07-01", "2030-06-29"), 6, "violation", 2], // 差一天满三年
    [fixed("2027-07-01", "2028-06-30"), 2, "ok", 2],
    [{ kind: "fixed" as const, months: 11 }, 2, "violation", 1],
    [{ kind: "open" as const }, 6, "ok", 6],
    [{ kind: "open" as const }, 7, "violation", 6],
  ])("%o，试用期 %i 个月 → %s（上限 %i 个月）", (term, months, verdict, limit) => {
    const r = checkProbationLimit(term, { months })!;
    expect(r.verdict).toBe(verdict);
    expect(r.steps.join()).toContain(`上限：${limit} 个月`);
  });
  it("试用期写成天数，按日历比：满 2 年的合同，60 天不超、63 天超", () => {
    const t = fixed("2027-07-01", "2029-06-30");
    expect(checkProbationLimit(t, { days: 62 })!.verdict).toBe("ok"); // 7-1 ~ 8-31 正好两个月
    expect(checkProbationLimit(t, { days: 63 })!.verdict).toBe("violation");
  });
  it("天数接近上限又不知道起算日时要用户确认", () => {
    expect(checkProbationLimit({ kind: "fixed", months: 24 }, { days: 60 })!.verdict).toBe(
      "needs_review",
    );
  });
});

describe("R02 不得约定试用期", () => {
  it.each([
    [{ kind: "fixed" as const, months: 2 }, "R02", "violation"],
    [{ kind: "task" as const }, "R02", "violation"],
    [{ kind: "fixed" as const, months: 3 }, "R01", "ok"],
  ])("%o，试用期 1 个月 → %s %s", (term, rule, verdict) => {
    const r = checkProbationLimit(term, { months: 1 })!;
    expect([r.rule, r.verdict]).toEqual([rule, verdict]);
  });
  it("没约定试用期时不报", () => {
    expect(checkProbationForbidden({ kind: "task" }, null)).toBeNull();
  });
});

describe("R03 只约定了试用期", () => {
  it("先签试用期合同、转正再签正式合同", () => {
    expect(checkProbationOnly({ probationOnly: true })!.verdict).toBe("violation");
  });
  it("合同期限就是试用期", () => {
    expect(
      checkProbationOnly({
        probationOnly: false,
        term: { kind: "fixed", months: 6 },
        probation: { months: 6 },
      })!.verdict,
    ).toBe("violation");
  });
  it("正常合同不报", () => {
    expect(
      checkProbationOnly({
        probationOnly: false,
        term: { kind: "fixed", months: 24 },
        probation: { months: 2 },
      }),
    ).toBeNull();
  });
});

describe("R05 试用期工资", () => {
  const sh = { monthly: 2740, label: "上海市 2740 元" };
  it.each([
    [10000, 8000, undefined, "ok"], // 正好 80%
    [10000, 7000, undefined, "likely_violation"],
    [3000, 2600, sh, "violation"],
    [3500, 2900, sh, "needs_review"], // 高出 5.8%
  ])("约定 %i，试用期 %i → %s", (agreed, probation, min, verdict) => {
    expect(
      checkProbationWage({ probationWage: probation, agreedWage: agreed, minWage: min })!.verdict,
    ).toBe(verdict);
  });
  it("缺少比较对象时不下结论", () => {
    expect(checkProbationWage({ probationWage: 5000 })!.verdict).toBe("unknown");
  });
});

describe("R06 违约金", () => {
  it("提前离职、试用期离职的违约金无效；服务期、竞业限制的不走这条", () => {
    const r = checkPenalties([
      { trigger: "early_resign", amount: 20000 },
      { trigger: "probation_resign", amount: 5000 },
      { trigger: "service_period", amount: 8000 },
      { trigger: "non_compete", amount: 50000 },
    ]);
    expect(r.map((x) => x.verdict)).toEqual(["violation", "violation"]);
  });
  it("违反保密的违约金无效，同时提示第九十条要赔损失", () => {
    const [r] = checkPenalties([{ trigger: "confidentiality", amount: 50000 }]);
    expect(r.verdict).toBe("violation");
    expect(r.basis).toContain("ldhtf-90-1");
    expect(r.note).toMatch(/赔偿实际损失/);
  });
});

describe("R07 服务期违约金", () => {
  it("12000 元培训费、36 个月服务期、已履行 12 个月，付全部培训费 → 违法，上限 8000", () => {
    const r = checkServicePeriod({
      trainingKind: "special",
      trainingCost: 12000,
      serviceMonths: 36,
      servedMonths: 12,
      penalty: { kind: "full_cost" },
    });
    expect(r.verdict).toBe("violation");
    expect(r.steps.join()).toContain("= 8000 元");
  });
  it("按未履行月数分摊 → 没问题", () => {
    expect(
      checkServicePeriod({
        trainingKind: "special",
        trainingCost: 12000,
        serviceMonths: 36,
        penalty: { kind: "prorated" },
      }).verdict,
    ).toBe("ok");
  });
  it("入职培训后服务 2 年，违约金 1 万 → 需要确认", () => {
    expect(
      checkServicePeriod({
        trainingKind: "onboarding",
        serviceMonths: 24,
        penalty: { kind: "amount", amount: 10000 },
      }).verdict,
    ).toBe("needs_review");
  });
  it("违约金超过培训费", () => {
    expect(
      checkServicePeriod({
        trainingKind: "special",
        trainingCost: 6000,
        serviceMonths: 24,
        penalty: { kind: "amount", amount: 10000 },
      }).verdict,
    ).toBe("violation");
  });
});

describe("R08 户口换服务期", () => {
  it("违约金无效，同时写明单位可以要求赔偿损失", () => {
    const r = checkSpecialBenefitPenalty({ benefit: "hukou", serviceYears: 5, amount: 150000 });
    expect(r.verdict).toBe("violation");
    expect(r.basis).toContain("ldzy-js2-12");
    expect(r.note).toMatch(/赔偿实际损失/);
  });
});

describe("R09 竞业限制", () => {
  it("离职后 3 年、无补偿 → 超期违法 + 提示可主张 30%", () => {
    const r = checkNonCompete({
      present: true,
      durationMonths: 36,
      compensation: "none",
      roleLevel: "unknown",
    });
    expect(r.map((x) => x.verdict)).toEqual(["violation", "advice"]);
    expect(r[1].note).toMatch(/30%/);
  });
  it("离职后 1 年、每月补偿 30%、管培生 → 要确认是否接触商业秘密", () => {
    const r = checkNonCompete({
      present: true,
      durationMonths: 12,
      compensation: "agreed",
      role: "管培生",
      roleLevel: "ordinary",
    });
    expect(r.map((x) => x.verdict)).toEqual(["needs_review"]);
  });
  it("技术总监在职期间不得兼职竞品 → 不报", () => {
    expect(
      checkNonCompete({
        present: true,
        compensation: "unknown",
        role: "技术总监",
        roleLevel: "senior",
        duringEmploymentOnly: true,
      }),
    ).toEqual([]);
  });
});

describe("R10 押金和证件", () => {
  it.each([
    ["deposit", 1],
    ["keep_original_certificate", 1],
    ["verify_original", 0],
  ] as const)("%s → %i 条违法", (kind, n) => {
    expect(checkDeposit([{ kind }]).length).toBe(n);
  });
});

describe("R11 必备条款", () => {
  it("缺社会保险和劳动保护两项", () => {
    const r = checkRequiredClauses({
      docKind: "劳动合同",
      present: { employer: true, employee: true, term: true, job: true, hours: true, pay: true },
    })!;
    expect(r.verdict).toBe("violation");
    expect(r.title).toMatch(/缺少 2 项/);
  });
  it("录用通知不查", () => {
    expect(checkRequiredClauses({ docKind: "录用通知", present: {} })).toBeNull();
  });
});

describe("R12 三方协议", () => {
  it("违约金写出相当于几个月工资，并指出不对等", () => {
    const [r] = checkTripartite({
      penalties: [
        { party: "student", amount: 10000 },
        { party: "employer", amount: 3000 },
      ],
      monthlyWage: 9000,
      standardTerms: [],
    });
    expect(r.verdict).toBe("advice");
    expect(r.steps.join()).toMatch(/1\.1 个月工资.*不对等/);
  });
  it("最终解释权条款 → 需要确认", () => {
    expect(
      checkTripartite({ penalties: [], standardTerms: ["最终解释权归甲方所有"] })[0].verdict,
    ).toBe("needs_review");
  });
});

describe("R13 ~ R16", () => {
  it("约定不缴社保无效，两头的后果都写", () => {
    const r = checkSocialInsurance({ waived: true, subsidy: 300 })!;
    expect(r.verdict).toBe("violation");
    expect(r.note).toMatch(/解除合同.*退回/);
  });
  it("单方调岗：没写降薪 → 可能违法；不服从视为自动离职 → 违法", () => {
    expect(checkUnilateralChange({ changes: ["position", "location", "wage"] })!.verdict).toBe(
      "likely_violation",
    );
    expect(checkUnilateralChange({ changes: ["position"], refuseMeansResign: true })!.verdict).toBe(
      "violation",
    );
  });
  it("末位淘汰 → 可能违法；试用期随时解除 → 违法", () => {
    const r = checkTerminationConditions([
      { kind: "other", text: "考核末位的，公司可解除合同" },
      { kind: "probation_at_will", text: "试用期内公司可随时解除合同，无需说明理由" },
      { kind: "statutory", text: "严重违反规章制度的" },
    ]);
    expect(r.map((x) => x.verdict)).toEqual(["likely_violation", "violation"]);
  });
  it.each([
    [{ noticeDays: 90, needsApproval: true }, 2],
    [{ probationNoticeDays: 30 }, 1],
    [{ noticeDays: 30 }, 0], // 合规时只有一条 ok
  ])("辞职限制 %o → %i 条违法", (input, n) => {
    expect(checkResignation(input).filter((x) => x.verdict === "violation").length).toBe(n);
  });
});

describe("四份示例合同对照标准答案", () => {
  type Answer = { rule: string; verdict: string };
  const answers = JSON.parse(readFileSync("data/samples/answers.json", "utf8")) as {
    samples: { id: string; findings: Answer[] }[];
  };
  const sh = { monthly: 2740, label: "上海市 2740 元" };
  const hz = { monthly: 2660, label: "杭州市 2660 元" };

  // 字段按合同原文人工填写；T09 的抽取步骤要能从原文得到同样的字段
  const run: Record<string, () => (Finding | null)[]> = {
    labor: () => [
      checkProbationLimit({ kind: "fixed", start: "2027-07-01", end: "2029-06-30" }, { months: 3 }),
      checkProbationWage({ probationWage: 8000, agreedWage: 10000, minWage: hz }),
      ...checkPenalties([{ trigger: "early_resign", amount: 20000 }]),
      checkServicePeriod({
        trainingKind: "special",
        trainingCost: 6000,
        serviceMonths: 24,
        penalty: { kind: "prorated" },
      }),
      ...checkNonCompete({
        present: true,
        durationMonths: 36,
        compensation: "none",
        role: "软件开发工程师",
        roleLevel: "unknown",
      }),
      checkRequiredClauses({
        docKind: "劳动合同",
        present: {
          employer: true,
          employee: true,
          term: true,
          job: true,
          hours: true,
          pay: true,
          social_insurance: true,
          protection: true,
        },
      }),
      ...checkResignation({ noticeDays: 30 }),
    ],
    tripartite: () => [
      checkProbationLimit({ kind: "fixed", months: 36 }, { months: 6 }),
      checkProbationWage({
        probationWage: 6000,
        agreedWage: 9000,
        minWage: { monthly: 2660, label: "苏州市 2660 元" },
      }),
      checkSpecialBenefitPenalty({ benefit: "hukou", serviceYears: 5, amount: 50000 }),
      ...checkTripartite({
        penalties: [
          { party: "student", amount: 10000 },
          { party: "employer", amount: 3000 },
        ],
        monthlyWage: 9000,
        standardTerms: ["最终解释权归甲方所有"],
      }),
    ],
    offer: () => [
      checkProbationWage({ probationWage: 2600, agreedWage: 6000, minWage: sh }),
      checkProbationOnly({ probationOnly: true }),
      ...checkDeposit([{ kind: "keep_original_certificate" }]),
    ],
    internship: () => [
      checkUnilateralChange({ changes: ["position", "location"], refuseMeansResign: true }),
      ...checkDeposit([{ kind: "deposit", amount: 500 }]),
      ...checkResignation({ noticeDays: 30, needsApproval: true }),
      ...checkPenalties([{ trigger: "early_resign" }]),
    ],
  };

  for (const s of answers.samples) {
    it(`${s.id}：标准答案里的每条结论规则都给出了`, () => {
      const got = run[s.id]().filter((x): x is Finding => x !== null);
      for (const a of s.findings) {
        const hit = got.find((g) => g.rule === a.rule && g.verdict === a.verdict);
        expect(hit, `${a.rule} ${a.verdict}`).toBeTruthy();
      }
    });
  }
});

describe("依据的条文 ID 都在库里", () => {
  it("每条规则 basis 里的 ID 都能在 data/clean 里找到（条或款）", () => {
    const ids = new Set<string>();
    for (const f of readdirSync("data/clean").filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(`data/clean/${f}`, "utf8")) as {
        articles: { id: string; paragraphs: { id: string }[] }[];
      };
      for (const a of d.articles) {
        ids.add(a.id);
        a.paragraphs.forEach((p) => ids.add(p.id));
      }
    }
    const src = readdirSync("mcp/labor-law/rules").filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const cited = new Set(
      src
        .flatMap(
          (f) =>
            readFileSync(`mcp/labor-law/rules/${f}`, "utf8").match(
              /"(ldhtf|ldhtf-tl|ldzy-js[12]|mfd|ldf|sbf)-[\d-]+"/g,
            ) ?? [],
        )
        .map((s) => s.slice(1, -1)),
    );
    expect([...cited].filter((id) => !ids.has(id))).toEqual([]);
    expect(cited.size).toBeGreaterThan(20);
  });
});
