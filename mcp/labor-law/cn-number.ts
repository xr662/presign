// 中文数字和阿拉伯数字互转，只覆盖条号会用到的范围（1~9999）。
// 法条标题写"第一千二百五十九条"，条文 ID 和规则里用 1259。

const DIGITS = "零一二三四五六七八九";

export function toChineseNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new RangeError(`不支持的条号：${n}`);
  if (n < 10) return DIGITS[n];
  if (n < 20) return "十" + (n % 10 ? DIGITS[n % 10] : "");
  if (n < 100) return DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? DIGITS[n % 10] : "");
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (r === 0) return DIGITS[h] + "百";
    if (r < 10) return DIGITS[h] + "百零" + DIGITS[r];
    // 百位以后的"十"要读成"一十"：一百一十五条，不是一百十五条
    return DIGITS[h] + "百" + (r < 20 ? "一" : "") + toChineseNumeral(r);
  }
  const t = Math.floor(n / 1000);
  const r = n % 1000;
  if (r === 0) return DIGITS[t] + "千";
  if (r < 100) return DIGITS[t] + "千零" + (r < 20 && r >= 10 ? "一" : "") + toChineseNumeral(r);
  return DIGITS[t] + "千" + toChineseNumeral(r);
}

const VALUE: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

export function parseChineseNumeral(s: string): number {
  let total = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in VALUE) {
      digit = VALUE[ch];
    } else if (ch in UNIT) {
      // "十五"开头没有数字，按"一十五"算
      total += (digit || 1) * UNIT[ch];
      digit = 0;
    } else {
      throw new Error(`不是中文数字：${s}`);
    }
  }
  return total + digit;
}
