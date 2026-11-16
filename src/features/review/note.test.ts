import { describe, expect, it } from "vitest";
import { PLAIN_VERIFY_NOTE, plainVerifyNote } from "./note";

describe("自检原因只给用户看白话", () => {
  it("出现字段名、英文代码就换成通用说明", () => {
    // 10-30 录用通知示例里的原话
    expect(
      plainVerifyNote(
        "抽取的字段可能和原文不一致：原文写毕业证、学位证原件交人事部保管至试用期结束，属 keep_original_certificate，而非 prepay_fee；kind 错误。",
      ),
    ).toBe(PLAIN_VERIFY_NOTE);
    expect(plainVerifyNote("probation 字段写成了 null")).toBe(PLAIN_VERIFY_NOTE);
  });

  it("白话原因原样保留，条号里的数字和金额不算代码", () => {
    const note = "原文写的是试用期 3 个月，抽取成了 6 个月。";
    expect(plainVerifyNote(note)).toBe(note);
    expect(plainVerifyNote("原文违约金是 20000 元，不是 2000 元")).toBe(
      "原文违约金是 20000 元，不是 2000 元",
    );
  });
});
