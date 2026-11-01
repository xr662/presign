import type { MergedLine } from "./align";

// 用户在识别结果里改字（11-01 实测：标了"请核对"的行没地方改）。
// 改过和新加的行标成 user：界面上"请核对"去掉、换成"改过"，送去检查的就是改后的文字。
// 第一行沿用原来的框，图上还能对照；拆出来或新加的行在图上没有对应位置，不画框。

const split = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * 把第 i 行改成 text。没变就返回原数组（调用方据此跳过更新）；清空就删掉这一行；
 * 粘贴进来的多行拆成多行。
 */
export function editLine(lines: MergedLine[], i: number, text: string): MergedLine[] {
  const old = lines[i];
  if (!old) return lines;
  const parts = split(text);
  if (parts.length === 1 && parts[0] === old.text.trim()) return lines;
  const next = parts.map((t, k): MergedLine => ({
    text: t,
    box: k === 0 ? old.box : null,
    source: "user",
  }));
  return [...lines.slice(0, i), ...next, ...lines.slice(i + 1)];
}

/**
 * 回车：先按 editLine 存下第 i 行，再在它后面插一个空行，给模型和本地识别都漏掉的行用。
 * 返回新行的位置，界面把光标放过去。第 i 行是空的就不加，免得连按回车堆出一串空行。
 */
export function addLineBelow(
  lines: MergedLine[],
  i: number,
  text: string,
): { lines: MergedLine[]; focus: number } | null {
  const n = split(text).length;
  if (n === 0) return null;
  const edited = editLine(lines, i, text);
  const at = i + n;
  return {
    lines: [...edited.slice(0, at), { text: "", box: null, source: "user" }, ...edited.slice(at)],
    focus: at,
  };
}
