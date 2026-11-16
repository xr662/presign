import { describe, expect, it } from "vitest";
import type { PracticeFinding, Turn } from "@/features/practice/scenario";
import {
  checkCoach,
  checkDebrief,
  citesOnlyBasis,
  coachMaterial,
  hrMaterial,
  screenInput,
} from "./practice";

// 录用通知示例里的一条（取自 public/recordings/offer.json，文字有删减）
const probationOnly: PracticeFinding = {
  id: "f1",
  verdict: "violation",
  clause: "四",
  quote: "入职后先签订 6 个月试用期合同，试用期满考核合格后再签订正式劳动合同",
  title: "只约定了试用期，试用期不成立",
  conclusion: "只签试用期合同，这种约定无效。依据劳动合同法第十九条第四款。",
  revision: { before: "入职后先签订 6 个月试用期合同", after: "入职时签订劳动合同，约定试用期" },
  talkingPoint:
    "劳动合同法第十九条第四款规定仅约定试用期的，试用期不成立，能否直接签正式劳动合同。",
  basis: [
    {
      label: "劳动合同法第十九条第四款",
      text: "试用期包含在劳动合同期限内。劳动合同仅约定试用期的，试用期不成立，该期限为劳动合同期限。",
    },
  ],
};

describe("教练提示只能引用报告里的依据", () => {
  it("条号在依据里出现过才通过；不提条号也通过", () => {
    expect(citesOnlyBasis("可以提劳动合同法第十九条", [probationOnly])).toBe(true);
    expect(citesOnlyBasis("没有引用条号", [probationOnly])).toBe(true);
    expect(citesOnlyBasis("依据第八十二条可以要求双倍工资", [probationOnly])).toBe(false);
  });

  it("引用了依据以外的条号：换成报告里写好的谈判要点", () => {
    const c = checkCoach(
      { hint: "依据劳动合同法第八十二条，可以要求双倍工资。", findingId: "f1", tone: "too_soft" },
      [probationOnly],
    );
    expect(c.hint).toBe(probationOnly.talkingPoint);
    expect(c.findingId).toBe("f1");
    expect(c.tone).toBe("too_soft");
  });

  it("findingId 不在这次的条款里：置空，提示本身没问题就保留", () => {
    const c = checkCoach({ hint: "先说是哪一条。", findingId: "f9", tone: null }, [probationOnly]);
    expect(c).toEqual({ hint: "先说是哪一条。", findingId: null, tone: null });
  });
});

describe("复盘", () => {
  const history: Turn[] = [
    { role: "me", text: "你好，第四条只签试用期合同，按劳动合同法第十九条第四款试用期不成立。" },
    { role: "hr", text: "这是公司统一模板。" },
    { role: "me", text: "能不能入职就签正式合同，试用期写在合同里？" },
  ];

  it("原话必须出自我说过的话（忽略空白），对不上的去掉；分数夹在 1~5", () => {
    const d = checkDebrief(
      {
        summary: "下次先说改法。",
        items: [
          {
            key: "basis",
            score: 7,
            comment: "依据讲清楚了",
            quote: "按劳动合同法第十九条第四款 试用期不成立",
          },
          { key: "revision", score: 3.6, comment: "提了改法", quote: "能不能直接取消试用期" },
          { key: "tone", score: 0, comment: "语气平稳", quote: "这是公司统一模板。" },
        ],
      },
      history,
    );
    expect(d.items.map((x) => x.score)).toEqual([5, 4, 1]);
    expect(d.items[0].quote).toBe("按劳动合同法第十九条第四款 试用期不成立");
    // 我没说过这句
    expect(d.items[1].quote).toBeNull();
    // HR 说的，不算我的原话
    expect(d.items[2].quote).toBeNull();
  });

  it("模型漏了某一项就不显示那一项，多给的同类项只取第一条", () => {
    const d = checkDebrief(
      {
        summary: "",
        items: [
          { key: "tone", score: 4, comment: "a", quote: null },
          { key: "tone", score: 2, comment: "b", quote: null },
        ],
      },
      history,
    );
    expect(d.items).toEqual([{ key: "tone", score: 4, comment: "a", quote: null }]);
  });
});

describe("材料", () => {
  it("HR 只看到条款原文和对方可能提的问题，看不到依据原文", () => {
    const m = hrMaterial([probationOnly]);
    expect(m).toContain("第四条");
    expect(m).toContain(probationOnly.quote!);
    expect(m).not.toContain("试用期包含在劳动合同期限内");
  });

  it("教练材料带编号、结论、改法和依据原文", () => {
    const m = coachMaterial([probationOnly]);
    expect(m).toContain("[f1]");
    expect(m).toContain("违法");
    expect(m).toContain("入职时签订劳动合同，约定试用期");
    expect(m).toContain("试用期包含在劳动合同期限内");
  });
});

describe("练习输入过滤", () => {
  it("空的和辱骂、威胁的拦下，正常的激烈措辞放行", () => {
    expect(screenInput("   ")).not.toBeNull();
    expect(screenInput("你们这样我就去死")).not.toBeNull();
    expect(screenInput("这条不合理，不改我不签")).toBeNull();
  });
});
