// 把一部法规的正文行切成"条 → 款 → 项"。
// 依据政府网站的排版习惯：每条以"第X条"开头独占一段；同一条后面不以"（一）"开头的段落是新的一款，
// 以"（一）"开头的是上一款里的项。章、节标题单独成行，记进条文的元数据。

import { parseChineseNumeral } from "./cn-number.ts";

export type Paragraph = {
  no: number; // 第几款，从 1 开始
  text: string; // 这一款的全文（含项）
  items: string[]; // 项，如"（一）用人单位的名称……"
  status?: "abolished";
  note?: string;
};

export type Article = {
  no: number;
  label: string; // 第十九条
  chapter?: string;
  section?: string;
  paragraphs: Paragraph[];
  text: string; // 整条全文，各款之间换行
};

const ARTICLE_HEAD = /^第([零〇一二两三四五六七八九十百千]+)条[\s　]*/;
const CHAPTER = /^第[零〇一二三四五六七八九十百]+[编分章]\s*\S*/;
const SECTION = /^第[零〇一二三四五六七八九十百]+节\s*\S*/;
const ITEM = /^[（(][零〇一二三四五六七八九十]+[）)]/;
// 正文后面常跟着页面尾部（"打印本页""相关链接"之类），遇到就停
const FINAL = /^本(法|条例|规定|解释|办法)自.{2,30}(施行|执行|实施)/;
const TAIL =
  /^(【?打印|关闭窗口|分享到|相关(链接|文章|新闻)|扫一扫|责任编辑|上一篇|下一篇|网站地图|版权所有|主办[:：])/;

export function parseArticles(lines: string[]): Article[] {
  const articles: Article[] = [];
  let chapter: string | undefined;
  let section: string | undefined;
  let cur: Article | null = null;
  // 法规的最后一条总是"本法（条例、规定、解释）自某日起施行"。读到这一条后，
  // 页面后面跟的"编辑""我要纠错""相关链接"、甚至整部法律再转载一遍，都不属于正文。
  let reachedFinal = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (reachedFinal) break;
    if (TAIL.test(line)) {
      if (cur) break;
      continue;
    }
    if (CHAPTER.test(line) && line.length <= 30) {
      chapter = line.replace(/\s+/g, " ");
      section = undefined;
      continue;
    }
    if (SECTION.test(line) && line.length <= 30) {
      section = line.replace(/\s+/g, " ");
      continue;
    }
    const head = line.match(ARTICLE_HEAD);
    if (head) {
      const no = parseChineseNumeral(head[1]);
      // 正文里引用"第三十九条"不会出现在段首；若条号回退（页面目录、重复转载），以第一次出现为准
      if (articles.some((a) => a.no === no)) {
        cur = null;
        continue;
      }
      cur = { no, label: `第${head[1]}条`, chapter, section, paragraphs: [], text: "" };
      articles.push(cur);
      const body = line.slice(head[0].length).trim();
      if (body) cur.paragraphs.push({ no: 1, text: body, items: [] });
      if (FINAL.test(body)) reachedFinal = true;
      continue;
    }
    if (!cur) continue;
    const last = cur.paragraphs.at(-1);
    if (ITEM.test(line) && last) {
      last.items.push(line);
      last.text += "\n" + line;
    } else if (!ITEM.test(line)) {
      cur.paragraphs.push({ no: cur.paragraphs.length + 1, text: line, items: [] });
    }
  }

  for (const a of articles) a.text = a.paragraphs.map((p) => p.text).join("\n");
  return articles;
}
