import { describe, expect, it } from "vitest";
import type { Box, MergedLine } from "./align";
import { addLineBelow, editLine } from "./edit-lines";

const box = (y: number): Box => [0, y, 100, y + 20];
const lines: MergedLine[] = [
  { text: "一、合同期限", box: box(0), source: "model" },
  { text: "试用期 3 个月", box: box(30), source: "local" },
  { text: "二、工作内容", box: box(60), source: "model" },
];

describe("改识别结果", () => {
  it("没改（或只多了首尾空格）就返回原数组，界面不更新", () => {
    expect(editLine(lines, 1, "试用期 3 个月")).toBe(lines);
    expect(editLine(lines, 1, "  试用期 3 个月\n")).toBe(lines);
  });

  it("改了字：沿用原来的框，来源改成 user，其他行不动", () => {
    const r = editLine(lines, 1, "试用期 2 个月");
    expect(r[1]).toEqual({ text: "试用期 2 个月", box: box(30), source: "user" });
    expect(r[0]).toBe(lines[0]);
    expect(r[2]).toBe(lines[2]);
    expect(lines[1].text).toBe("试用期 3 个月");
  });

  it("清空就删掉这一行", () => {
    const r = editLine(lines, 1, "  ");
    expect(r.map((l) => l.text)).toEqual(["一、合同期限", "二、工作内容"]);
  });

  it("粘贴进来多行：拆开，只有第一行带框", () => {
    const r = editLine(lines, 1, "试用期 2 个月\n\n试用期工资 8000 元");
    expect(r.map((l) => l.text)).toEqual([
      "一、合同期限",
      "试用期 2 个月",
      "试用期工资 8000 元",
      "二、工作内容",
    ]);
    expect(r[1].box).toEqual(box(30));
    expect(r[2].box).toBeNull();
  });

  it("下标越界时原样返回", () => {
    expect(editLine(lines, 5, "x")).toBe(lines);
  });
});

describe("回车加一行", () => {
  it("存下当前行，在后面插空行，光标放到空行", () => {
    const r = addLineBelow(lines, 0, "一、合同期限");
    expect(r?.focus).toBe(1);
    expect(r?.lines.map((l) => l.text)).toEqual([
      "一、合同期限",
      "",
      "试用期 3 个月",
      "二、工作内容",
    ]);
    expect(r?.lines[1]).toEqual({ text: "", box: null, source: "user" });
  });

  it("当前行同时被改成两行时，空行插在两行之后", () => {
    const r = addLineBelow(lines, 1, "试用期 2 个月\n试用期工资 8000 元");
    expect(r?.focus).toBe(3);
    expect(r?.lines.map((l) => l.text)).toEqual([
      "一、合同期限",
      "试用期 2 个月",
      "试用期工资 8000 元",
      "",
      "二、工作内容",
    ]);
  });

  it("当前行是空的就不加", () => {
    expect(addLineBelow(lines, 1, "")).toBeNull();
  });
});
