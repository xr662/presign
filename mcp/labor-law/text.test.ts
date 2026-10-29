import { describe, expect, it } from "vitest";
import { parseChineseNumeral, toChineseNumeral } from "./cn-number.ts";
import { parseArticles } from "./parse-law.ts";
import { bigrams, htmlToLines } from "./text.ts";

describe("中文数字", () => {
  it.each([
    [1, "一"],
    [10, "十"],
    [19, "十九"],
    [20, "二十"],
    [100, "一百"],
    [107, "一百零七"],
    [115, "一百一十五"],
    [585, "五百八十五"],
    [1000, "一千"],
    [1012, "一千零一十二"],
    [1259, "一千二百五十九"],
  ])("%i 与 %s 互转", (n, cn) => {
    expect(toChineseNumeral(n)).toBe(cn);
    expect(parseChineseNumeral(cn)).toBe(n);
  });

  it("全部条号来回转换一致", () => {
    for (let n = 1; n <= 1260; n++) expect(parseChineseNumeral(toChineseNumeral(n))).toBe(n);
  });
});

describe("二字切分", () => {
  it("中文切成相邻两字，数字整词保留", () => {
    expect(bigrams("试用期3个月")).toBe("试用 用期 3 个月");
  });
  it("两个字的词能被切出来（trigram 分词做不到的）", () => {
    expect(bigrams("社保").split(" ")).toContain("社保");
  });
  it("单个汉字保留", () => {
    expect(bigrams("款")).toBe("款");
  });
});

describe("条款切分", () => {
  const html = `
    <p>第一章　总则</p>
    <p>第十七条　劳动合同应当具备以下条款:</p>
    <p>（一）用人单位的名称；</p>
    <p>（二）劳动合同期限；</p>
    <p>劳动合同除前款规定的必备条款外，可以约定试用期。</p>
    <p>第十八条　劳动合同对劳动报酬约定不明确的，依照本法第三十九条处理。</p>
    <p>第十九条　本法自2008年1月1日起施行。</p>
    <p>【我要纠错】</p>`;
  const arts = parseArticles(htmlToLines(html));

  it("识别条号和章", () => {
    expect(arts.map((a) => a.no)).toEqual([17, 18, 19]);
    expect(arts[0].chapter).toBe("第一章 总则");
  });
  it("以（一）开头的是项，其他段落是新的一款", () => {
    expect(arts[0].paragraphs).toHaveLength(2);
    expect(arts[0].paragraphs[0].items).toHaveLength(2);
    expect(arts[0].paragraphs[1].text).toMatch(/^劳动合同除前款/);
  });
  it("正文里引用别的条号不会被当成新条", () => {
    expect(arts[1].paragraphs).toHaveLength(1);
  });
  it("读到施行日期条后，页面尾部不进正文", () => {
    expect(arts[2].text).toBe("本法自2008年1月1日起施行。");
  });
});
