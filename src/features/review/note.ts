// 自检没通过的原因会显示在批注卡上。提示词要求用白话写（verify-v3），这里再兜一道底：
// 原因里出现程序内部的字段名或英文代码（keep_original_certificate、kind 之类）就换成通用说明，
// 用户看不懂这些词。10-30 录的示例合同用的是 verify-v2，回放时也靠这里。

const INTERNAL = /[A-Za-z]+_[A-Za-z_]+|\b(kind|null|true|false|none|undefined)\b/;

export const PLAIN_VERIFY_NOTE = "抽取出的内容和合同原文对不上，请对照原文核实这一条。";

export function plainVerifyNote(note: string): string {
  return INTERNAL.test(note) ? PLAIN_VERIFY_NOTE : note;
}
