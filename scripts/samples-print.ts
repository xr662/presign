// 把 data/samples/ 下的示例合同排成 A4 打印版 HTML，给队友打印出来拍测试照片。
// 用浏览器打开后 Ctrl+P 打印即可。宋体、小四号、1.8 倍行距，接近常见的纸质合同。
// 用法：node scripts/samples-print.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "docs/team/示例合同打印版";
const FILES = [
  ["labor", "劳动合同"],
  ["tripartite", "三方协议"],
  ["offer", "录用通知"],
  ["internship", "实习协议"],
] as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

mkdirSync(OUT, { recursive: true });
for (const [id, name] of FILES) {
  const lines = readFileSync(`data/samples/${id}.md`, "utf8").trim().split(/\r?\n/);
  const [title, ...rest] = lines;
  const body = rest
    .map((l) => {
      if (!l.trim()) return "";
      // "第一条 工作内容"这类条款标题和"一、"开头的条款加粗，方便识别时看分段
      if (/^第[一二三四五六七八九十]+条\s/.test(l)) return `<h2>${esc(l)}</h2>`;
      if (/^（本.*虚构示例/.test(l)) return `<p class="note">${esc(l)}</p>`;
      return `<p>${esc(l)}</p>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}（示例）</title>
<style>
  @page { size: A4; margin: 25mm 22mm; }
  body { font-family: "SimSun", "Songti SC", "STSong", serif; font-size: 12pt; line-height: 1.8; color: #000; max-width: 166mm; margin: 0 auto; }
  h1 { text-align: center; font-size: 18pt; letter-spacing: 4px; margin: 0 0 18pt; }
  h2 { font-size: 12pt; margin: 10pt 0 2pt; }
  p { margin: 0 0 4pt; text-indent: 0; white-space: pre-wrap; }
  .note { margin-top: 24pt; font-size: 10pt; color: #444; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
</body>
</html>
`;
  writeFileSync(`${OUT}/${name}.html`, html);
  console.log(`${OUT}/${name}.html`);
}
