// 上传前在浏览器里找出身份证号、手机号、银行卡号、邮箱，返回要涂黑的框。
// 输入是本地 OCR 的结果（每个词带框），输出的框直接画在要上传的图片上。
//
// 宁可多涂不可漏涂：身份证号只看格式（6 位地区 + 合理的出生日期 + 4 位），不要求校验位正确，
// 因为本地 OCR 认错一位数字就会让校验失败；银行卡号要过 Luhn 校验，避免把合同金额、编号涂掉。

import type { Box } from "./align";

export type OcrWord = { text: string; box: Box };
export type OcrWordLine = { text: string; box: Box; words: OcrWord[] };
export type Sensitive = { kind: "id" | "phone" | "card" | "email"; text: string; box: Box };

const ID = /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CARD = /(?<!\d)\d{16,19}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const union = (boxes: Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
];

/** 外扩几个像素，免得字的边缘露出来 */
const pad = (b: Box, p: number): Box => [b[0] - p, b[1] - p, b[2] + p, b[3] + p];

export function findSensitive(lines: OcrWordLine[]): Sensitive[] {
  const out: Sensitive[] = [];
  for (const line of lines) {
    // 去掉空格拼成一串，记下每个字属于哪个词；本地 OCR 常把一串数字拆成几个词
    let s = "";
    const owner: number[] = [];
    line.words.forEach((w, wi) => {
      for (const ch of w.text.replace(/\s/g, "")) {
        s += ch;
        owner.push(wi);
      }
    });
    const taken = new Array<boolean>(s.length).fill(false);
    const add = (kind: Sensitive["kind"], m: RegExpMatchArray) => {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.slice(start, end).some(Boolean)) return;
      for (let i = start; i < end; i++) taken[i] = true;
      const words = [...new Set(owner.slice(start, end))].map((i) => line.words[i].box);
      const h = line.box[3] - line.box[1];
      out.push({ kind, text: m[0], box: pad(union(words), Math.max(2, h * 0.15)) });
    };
    // 身份证号先找，免得它的后 11 位被当成手机号
    for (const m of s.matchAll(ID)) add("id", m);
    for (const m of s.matchAll(PHONE)) add("phone", m);
    for (const m of s.matchAll(CARD)) if (luhn(m[0])) add("card", m);
    for (const m of s.matchAll(EMAIL)) add("email", m);
  }
  return out;
}

/** 文字里的敏感信息换成 □（PDF 文字层、粘贴的文字没有图片可涂，就在文字上处理） */
export function maskText(s: string): string {
  const mask = (m: string) => "□".repeat(m.length);
  return s
    .replace(ID, mask)
    .replace(PHONE, mask)
    .replace(CARD, (m) => (luhn(m) ? mask(m) : m))
    .replace(EMAIL, mask);
}
