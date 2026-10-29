// 文本处理：把政府网站的 HTML 变成按段落分行的纯文本，以及中文检索用的二字切分。

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  hellip: "…",
  middot: "·",
  ensp: " ",
  emsp: "　",
};

/** 按页面声明的编码解码。部分政府网站还是 GBK，直接当 UTF-8 读会乱码。 */
export function decodeHtml(buf: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 4096));
  const declared = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? "utf-8";
  const charset = declared === "gb2312" ? "gbk" : declared;
  return new TextDecoder(charset).decode(buf);
}

/** HTML → 行。块级标签结束处换行，这样一个 <p> 正好是一段（法条的一款或一项）。 */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|section|article|table|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n: string) => ENTITIES[n] ?? m);
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\r ]+/g, " ").trim())
    .filter(Boolean);
}

const CJK = /[㐀-鿿豈-﫿]/;

/**
 * 中文二字切分："试用期不得超过" → "试用 用期 期不 不得 得超 超过"。
 * FTS5 自带的 trigram 分词查不到两个字的词（"社保""押金"），unicode61 又不会切中文，
 * 所以入库时另存一列切好的文本，查询时用同样的方法切。数字和英文按整词保留。
 */
export function bigrams(text: string): string {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    run = "";
  };
  for (const tok of text.split(/([㐀-鿿豈-﫿]+|[A-Za-z0-9.]+)/)) {
    if (!tok) continue;
    if (CJK.test(tok)) {
      run += tok;
    } else {
      flush();
      if (/^[A-Za-z0-9.]+$/.test(tok)) out.push(tok.toLowerCase());
    }
  }
  flush();
  return out.join(" ");
}
