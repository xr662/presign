// 色板对比度检查：界面上实际会出现的"文字色 / 底色"组合，按 WCAG 2 公式计算，低于 4.5:1 报错。
// 色值从 globals.css 读，改了色板直接重跑，不用改这里。
// 用法：node scripts/contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
const color = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`globals.css 里没有找到 --${name}`);
  return m[1];
};

// 每一对都是界面里真实用到的：正文、次要文字、三种批注标签、检查通过计数、主按钮
const PAIRS = [
  ["ink", "paper"],
  ["ink-2", "paper"],
  ["ink-2", "paper-2"],
  ["pencil", "paper"],
  ["red-pen", "red-pen-bg"],
  ["red-pen", "paper"],
  ["orange", "orange-bg"],
  ["orange", "paper"],
  ["pencil", "pencil-bg"],
  ["ok", "paper-2"],
  ["paper", "ink"],
];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let failed = 0;
for (const [fg, bg] of PAIRS) {
  const [l1, l2] = [luminance(color(fg)), luminance(color(bg))].sort((a, b) => b - a);
  const ratio = (l1 + 0.05) / (l2 + 0.05);
  const ok = ratio >= 4.5;
  if (!ok) failed++;
  console.log(`${ok ? "通过" : "不足"}  ${fg} / ${bg}  ${ratio.toFixed(2)}:1`);
}
if (failed) process.exit(1);
