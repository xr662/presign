// 期限计算。规则清单的约定：end ≥ start + N 个月 − 1 天，视为满 N 个月（满 N 年同理）；
// "以上"包括本数、"不满"不包括本数（民法典第一千二百五十九条）。按日历算，不按 30 天一个月粗算。

const DAY = 86400_000;

/** "2027-07-01" → UTC 毫秒 */
export function parseDate(s: string): number {
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error(`日期格式不对：${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 起始日加 N 个月；目标月没有这一天时取月末（1 月 31 日加一个月是 2 月 28 或 29 日） */
export function addMonths(start: string, months: number): number {
  const t = new Date(parseDate(start));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + months;
  const d = t.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d, last));
}

/** start 到 end（含两端）是否满 N 个月 */
export function reachesMonths(start: string, end: string, months: number): boolean {
  return parseDate(end) >= addMonths(start, months) - DAY;
}

export const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const prevDay = (ms: number) => fmt(ms - DAY);
