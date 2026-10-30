import { describe, expect, it } from "vitest";
import type { Box } from "./align";
import { findSensitive, luhn, maskText, type OcrWordLine } from "./redact";

// 按字给框：每个字 10 像素宽，方便检查涂黑范围
function line(text: string, y = 0, split?: number[]): OcrWordLine {
  const cuts = split ?? [text.length];
  const words = [];
  let start = 0;
  for (const end of cuts) {
    const t = text.slice(start, end);
    words.push({ text: t, box: [start * 10, y, end * 10, y + 20] as Box });
    start = end;
  }
  return { text, box: [0, y, text.length * 10, y + 20], words };
}

describe("找敏感信息", () => {
  it("身份证号：只看格式，校验位错了也涂（示例合同里的号码校验位故意写错）", () => {
    const r = findSensitive([line("居民身份证号码：330106200403150010", 0, [8, 26])]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("id");
    // 只涂号码那个词，不涂前面的标签
    expect(r[0].box[0]).toBeLessThan(80);
    expect(r[0].box[0]).toBeGreaterThan(70);
    expect(r[0].box[2]).toBeGreaterThan(260);
  });

  it("号码被本地 OCR 拆成几个词时，框取这几个词的外接框", () => {
    const r = findSensitive([line("身份证 330106 20040315 0010", 0, [3, 10, 19, 24])]);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("330106200403150010");
  });

  it("手机号，身份证号的后几位不会被当成手机号", () => {
    const r = findSensitive([line("联系电话：13800138000"), line("320508200411180040", 30)]);
    expect(r.map((x) => x.kind)).toEqual(["phone", "id"]);
  });

  it("银行卡号要过 Luhn 校验，合同金额和编号不涂", () => {
    expect(luhn("6222020200112233440")).toBe(false);
    expect(luhn("4111111111111111")).toBe(true);
    const r = findSensitive([
      line("卡号4111111111111111"),
      line("合同编号2027070100000001", 30),
      line("违约金人民币 20000 元", 60),
    ]);
    expect(r.map((x) => x.kind)).toEqual(["card"]);
  });

  it("邮箱", () => {
    expect(findSensitive([line("邮箱：zhang.san@example.com")])[0].kind).toBe("email");
  });

  it("日期、金额、条款编号都不涂", () => {
    const r = findSensitive([
      line("劳动合同期限自 2027 年 7 月 1 日起至 2029 年 6 月 30 日止"),
      line("月工资 10000 元，每月 15 日前支付", 30),
    ]);
    expect(r).toEqual([]);
  });
});

describe("文字打码", () => {
  it("身份证号、手机号换成同样长度的 □，其他不动", () => {
    expect(maskText("身份证：330106200403150010，电话 13800138000，月薪 10000 元")).toBe(
      `身份证：${"□".repeat(18)}，电话 ${"□".repeat(11)}，月薪 10000 元`,
    );
  });
});
