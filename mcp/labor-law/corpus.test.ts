// 入库文本核对：规划文档《规则清单》里引用的法条原文，是 10-29 从官方页面人工逐字核对过的。
// 这里用同样的原文去比对解析结果，一个字不对就失败。规则清单引用的条文 ID 也必须都能查到。
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Clean = {
  id: string;
  articles: {
    id: string;
    text: string;
    paragraphs: { id: string; text: string; status?: string }[];
  }[];
};

const docs: Clean[] = readdirSync("data/clean")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`data/clean/${f}`, "utf8")) as Clean);
const paragraph = new Map<string, { text: string; status?: string }>();
const article = new Map<string, string>();
for (const d of docs)
  for (const a of d.articles) {
    article.set(a.id, a.text);
    for (const p of a.paragraphs) paragraph.set(p.id, p);
  }

const QUOTES: [string, string][] = [
  [
    "ldhtf-19-1",
    "劳动合同期限三个月以上不满一年的，试用期不得超过一个月；劳动合同期限一年以上不满三年的，试用期不得超过二个月；三年以上固定期限和无固定期限的劳动合同，试用期不得超过六个月。",
  ],
  [
    "ldhtf-19-3",
    "以完成一定工作任务为期限的劳动合同或者劳动合同期限不满三个月的，不得约定试用期。",
  ],
  [
    "ldhtf-19-4",
    "试用期包含在劳动合同期限内。劳动合同仅约定试用期的，试用期不成立，该期限为劳动合同期限。",
  ],
  [
    "ldhtf-20-1",
    "劳动者在试用期的工资不得低于本单位相同岗位最低档工资或者劳动合同约定工资的百分之八十，并不得低于用人单位所在地的最低工资标准。",
  ],
  [
    "ldhtf-25-1",
    "除本法第二十二条和第二十三条规定的情形外，用人单位不得与劳动者约定由劳动者承担违约金。",
  ],
  [
    "ldhtf-9-1",
    "用人单位招用劳动者，不得扣押劳动者的居民身份证和其他证件，不得要求劳动者提供担保或者以其他名义向劳动者收取财物。",
  ],
  [
    "ldhtf-37-1",
    "劳动者提前三十日以书面形式通知用人单位，可以解除劳动合同。劳动者在试用期内提前三日通知用人单位，可以解除劳动合同。",
  ],
  [
    "ldhtf-90-1",
    "劳动者违反本法规定解除劳动合同，或者违反劳动合同中约定的保密义务或者竞业限制，给用人单位造成损失的，应当承担赔偿责任。",
  ],
  [
    "ldhtf-tl-15-1",
    "劳动者在试用期的工资不得低于本单位相同岗位最低档工资的80%或者不得低于劳动合同约定工资的80%，并不得低于用人单位所在地的最低工资标准。",
  ],
  [
    "ldzy-js2-19-1",
    "用人单位与劳动者约定或者劳动者向用人单位承诺无需缴纳社会保险费的，人民法院应当认定该约定或者承诺无效。用人单位未依法缴纳社会保险费，劳动者根据劳动合同法第三十八条第一款第三项规定请求解除劳动合同、由用人单位支付经济补偿的，人民法院依法予以支持。",
  ],
  [
    "ldzy-js2-13-1",
    "劳动者未知悉、接触用人单位的商业秘密和与知识产权相关的保密事项，劳动者请求确认竞业限制条款不生效的，人民法院依法予以支持。",
  ],
  [
    "mfd-585-2",
    "约定的违约金低于造成的损失的，人民法院或者仲裁机构可以根据当事人的请求予以增加；约定的违约金过分高于造成的损失的，人民法院或者仲裁机构可以根据当事人的请求予以适当减少。",
  ],
  [
    "mfd-1259-1",
    "民法所称的“以上”、“以下”、“以内”、“届满”，包括本数；所称的“不满”、“超过”、“以外”，不包括本数。",
  ],
];

describe("入库原文与人工核对的原文逐字一致", () => {
  it.each(QUOTES)("%s", (id, text) => {
    expect(paragraph.get(id)?.text).toBe(text);
  });
});

describe("条数和 ID", () => {
  it("规则清单引用的条文都在库里", () => {
    const cited = [
      "ldhtf-9",
      "ldhtf-17",
      "ldhtf-19",
      "ldhtf-20",
      "ldhtf-21",
      "ldhtf-22",
      "ldhtf-23",
      "ldhtf-24",
      "ldhtf-25",
      "ldhtf-26",
      "ldhtf-35",
      "ldhtf-37",
      "ldhtf-39",
      "ldhtf-40",
      "ldhtf-41",
      "ldhtf-81",
      "ldhtf-83",
      "ldhtf-84",
      "ldhtf-87",
      "ldhtf-90",
      "ldhtf-tl-15",
      "ldhtf-tl-16",
      "ldhtf-tl-26",
      "ldzy-js1-36",
      "ldzy-js1-38",
      "ldzy-js1-39",
      "ldzy-js2-12",
      "ldzy-js2-13",
      "ldzy-js2-14",
      "ldzy-js2-19",
      "mfd-496",
      "mfd-497",
      "mfd-498",
      "mfd-585",
      "mfd-1259",
    ];
    expect(cited.filter((id) => !article.has(id))).toEqual([]);
  });

  it("解释（一）第三十二条第一款标为已废止", () => {
    expect(paragraph.get("ldzy-js1-32-1")?.status).toBe("abolished");
  });
});
