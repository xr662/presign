import { describe, expect, it } from "vitest";
import { alignLines, mergeRecognition, similarity, type Box, type LocalLine } from "./align";
import { groupPdfItems } from "./pdf-lines";

const box = (y: number): Box => [100, y, 900, y + 20];
const local = (...texts: string[]): LocalLine[] =>
  texts.map((t, i) => ({ text: t, box: box(i * 30) }));

describe("相似度", () => {
  it("相同为 1，无关为 0，忽略标点和空格", () => {
    expect(similarity("试用期 3 个月。", "试用期3个月")).toBe(1);
    expect(similarity("试用期", "违约金")).toBe(0);
  });
  it("本地 OCR 的错字只降低一部分分数", () => {
    expect(
      similarity("甲方（用人单位）：示例科技有限公司", "甲方《用人单位):示例科技有限公司"),
    ).toBeGreaterThan(0.8);
  });
});

describe("行对齐", () => {
  const model = [
    "劳动合同书",
    "甲方（用人单位）：示例科技有限公司",
    "住所：浙江省杭州市西湖区示例路 1 号",
    "法定代表人：王某某",
  ];

  it("一一对应时每行拿到对应的框", () => {
    const r = alignLines(
      model,
      local(
        "劳动合同书",
        "甲方《用人单位):示例科技有限公司",
        "住所:浙江省杭州市西湖区示例路1号",
        "法定代表人:王某某",
      ),
    );
    expect(r.map((x) => x.box?.[1])).toEqual([0, 30, 60, 90]);
    expect(r.map((x) => x.text)).toEqual(model);
  });

  it("本地把一行切成两段时，框取两段的外接框", () => {
    const r = alignLines(
      model,
      local(
        "劳动合同书",
        "甲方（用人单位）：",
        "示例科技有限公司",
        "住所：浙江省杭州市西湖区示例路1号",
        "法定代表人：王某某",
      ),
    );
    expect(r[1].box).toEqual([100, 30, 900, 80]);
    expect(r[2].box?.[1]).toBe(90);
  });

  it("本地把两行粘在一起时，按字数上下切开", () => {
    const r = alignLines(
      model,
      local(
        "劳动合同书",
        "甲方（用人单位）：示例科技有限公司住所：浙江省杭州市西湖区示例路1号",
        "法定代表人：王某某",
      ),
    );
    expect(r[1].box![1]).toBe(30);
    expect(r[2].box![3]).toBe(50);
    expect(r[1].box![3]).toBeCloseTo(r[2].box![1]);
    expect(r[3].box![1]).toBe(60);
  });

  it("本地漏掉一行时那一行没有框，其他行不受影响", () => {
    const r = alignLines(
      model,
      local("劳动合同书", "住所：浙江省杭州市西湖区示例路1号", "法定代表人：王某某"),
    );
    expect(r[1].box).toBeNull();
    expect(r[2].box?.[1]).toBe(30);
  });

  it("本地多出来的噪声行被跳过", () => {
    const r = alignLines(
      model,
      local(
        "劳动合同书",
        "|||",
        "甲方（用人单位）：示例科技有限公司",
        "住所：浙江省杭州市西湖区示例路1号",
        "页码 1",
        "法定代表人：王某某",
      ),
    );
    expect(r.map((x) => x.box?.[1])).toEqual([0, 60, 90, 150]);
  });

  it("文字完全对不上时不硬配", () => {
    const r = alignLines(["第七条 违约金"], local("abcdef"));
    expect(r[0].box).toBeNull();
  });
});

describe("PDF 文字层分行", () => {
  it("同一行的几段按横坐标拼起来，行按纵坐标排序", () => {
    const lines = groupPdfItems([
      { str: "其中试用期 3 个月。", x: 300, y: 100, w: 150, h: 14 },
      { str: "第三条", x: 50, y: 101, w: 40, h: 14 },
      { str: "劳动合同期限 2 年，", x: 95, y: 100, w: 200, h: 14 },
      { str: "劳动合同书", x: 200, y: 40, w: 100, h: 20 },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "劳动合同书",
      "第三条劳动合同期限 2 年，其中试用期 3 个月。",
    ]);
    expect(lines[1].box).toEqual([50, 100, 450, 115]);
  });
  it("字间距排开的标题，汉字之间不留空格", () => {
    const items = [..."录用通知书"].map((ch, i) => ({
      str: ch,
      x: 100 + i * 40,
      y: 10,
      w: 18,
      h: 18,
    }));
    expect(groupPdfItems(items)[0].text).toBe("录用通知书");
  });
  it("间隔大于一个字宽补空格", () => {
    expect(
      groupPdfItems([
        { str: "甲方（盖章）：", x: 50, y: 10, w: 100, h: 14 },
        { str: "乙方（签字）：", x: 400, y: 10, w: 100, h: 14 },
      ])[0].text,
    ).toBe("甲方（盖章）： 乙方（签字）：");
  });
});

describe("合并与续识别", () => {
  const page = local(
    "劳动合同书",
    "第五条劳动报酬",
    "乙方试用期月工资8000元，转正后月工资10000元。",
    "第六条社会保险",
    "甲方依法为乙方缴纳社会保险费和住房公积金",
  );
  it("模型中途停下时给出续识别的位置，末尾未识别部分不先塞本地文字", () => {
    const r = mergeRecognition(["劳动合同书", "第五条 劳动报酬"], page);
    expect(r.resumeFromY).toBe(60);
    expect(r.lines.map((l) => l.text)).toEqual(["劳动合同书", "第五条 劳动报酬"]);
  });
  it("中间零星漏掉的行用本地文字补上并标出来", () => {
    const r = mergeRecognition(
      [
        "劳动合同书",
        "第五条 劳动报酬",
        "第六条 社会保险",
        "甲方依法为乙方缴纳社会保险费和住房公积金",
      ],
      page,
    );
    expect(r.resumeFromY).toBeNull();
    expect(r.lines.map((l) => l.source)).toEqual(["model", "model", "local", "model", "model"]);
    expect(r.lines[2].text).toMatch(/^乙方试用期/);
  });
  it("全部对上时没有补行", () => {
    const r = mergeRecognition(
      page.map((p) => p.text),
      page,
    );
    expect(r.lines.every((l) => l.source === "model")).toBe(true);
    expect(r.resumeFromY).toBeNull();
  });
});
