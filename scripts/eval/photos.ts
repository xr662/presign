// 实拍照片评测（T06 验收、T17）：队友用手机拍的四份示例合同，先识别成文字，再交给审查流程。
// 照片在 eval/photos/，命名 合同_拍法_手机_页码.jpg，拍法见 docs/team/拍照清单.md：
//   a 平放正拍  b 斜拍约 30 度  c 一侧亮一侧暗  d 晚上室内灯光  e 对折过、有折痕
// 照片已按 EXIF 方向摆正、长边缩到 2000 像素（和网站上传前的处理一样）、去掉 EXIF。照片不进仓库：
// 打印页脚印着打印用电脑的文件路径。识别出的文字在 eval/photos/ocr/，那几行路径已换成说明。
//
// 这个脚本做第一步：每张照片按网站同样的提示词让模型识别（只用模型的文字，不做本地 Tesseract 补行，
// 结果比网站略保守），和示例合同原文比，算"原文的字认出了多少"：
//   识别率 = 原文和识别结果的最长公共子序列长度 / 原文字数，比之前去掉空白和标点。
//   页眉页脚（打印时间、"示例"字样）多认出来的字不扣分，漏字、错字扣分。
// 识别出的文字写到 eval/photos/ocr/，同时生成 eval/photos/answers.json（标准答案和示例合同相同），
// 第二步用 node scripts/eval/review.ts --set photos 跑审查。
//
// 用法：node scripts/eval/photos.ts [--only offer_a,labor_b]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { limitsFromEnv, rolesFromEnv } from "../../src/lib/ai/config.ts";
import { createAi } from "../../src/lib/ai/core.ts";
import { UsageStore } from "../../src/lib/ai/usage.ts";
import { OCR_PROMPT } from "../../src/prompts/ocr.ts";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1].split(",")) : null;

process.loadEnvFile(".env.local");
const usage = new UsageStore(":memory:");
const ai = createAi({ roles: rolesFromEnv(), limits: limitsFromEnv(), usage });

const KIND: Record<string, string> = {
  labor: "劳动合同",
  tripartite: "三方协议",
  offer: "录用通知",
  internship: "实习协议",
};
const CONDITION: Record<string, string> = {
  a: "平放正拍",
  b: "斜拍",
  c: "光线不均",
  d: "夜间室内",
  e: "有折痕",
};

// 去掉空白和标点，只比字和数字
const strip = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, "");

function lcs(a: string, b: string): number {
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

async function ocr(file: string): Promise<{ lines: string[]; ms: number }> {
  const bytes = new Uint8Array(readFileSync(`eval/photos/${file}`));
  const t0 = Date.now();
  const call = () =>
    ai.generateObject("ocr", z.object({ lines: z.array(z.string()).max(200) }), {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT.text },
            { type: "file", data: bytes, mediaType: "image/jpeg" },
          ],
        },
      ],
      timeoutMs: 60_000,
      hedgeMs: 30_000,
    });
  // 平台限并发（429）时等 20 秒再试一次
  const out = await call().catch(async () => {
    await new Promise((ok) => setTimeout(ok, 20_000));
    return call();
  });
  return { lines: out.lines, ms: Date.now() - t0 };
}

const photos = readdirSync("eval/photos").filter((f) => f.endsWith(".jpg"));
const groups = new Map<string, string[]>();
for (const f of photos.sort()) {
  const [doc, cond] = f.split("_");
  const id = `${doc}_${cond}`;
  if (only && !only.has(id)) continue;
  groups.set(id, [...(groups.get(id) ?? []), f]);
}

const answers = JSON.parse(readFileSync("data/samples/answers.json", "utf8")) as {
  samples: { id: string; findings: unknown[] }[];
};
mkdirSync("eval/photos/ocr", { recursive: true });
const rows: Record<string, unknown>[] = [];
for (const [id, files] of groups) {
  const [doc, cond] = id.split("_");
  const pages = [];
  for (const f of files) pages.push(await ocr(f));
  const text = pages.map((p) => p.lines.join("\n")).join("\n");
  writeFileSync(`eval/photos/ocr/${id}.md`, `${text}\n`);
  const truth = strip(readFileSync(`data/samples/${doc}.md`, "utf8"));
  const rate = lcs(truth, strip(text)) / truth.length;
  const ms = pages.reduce((n, p) => n + p.ms, 0);
  rows.push({ id, doc, condition: cond, pages: files.length, rate, ms });
  console.log(
    `${id}（${KIND[doc]}，${CONDITION[cond]}，${files.length} 页）识别率 ${(rate * 100).toFixed(1)}%，${(ms / 1000).toFixed(1)} 秒`,
  );
}

if (!only) {
  writeFileSync(
    "eval/photos/answers.json",
    `${JSON.stringify(
      {
        $comment:
          "实拍照片识别后的文字，标准答案和 data/samples/answers.json 相同（scripts/eval/photos.ts 生成）",
        dir: "eval/photos/ocr",
        samples: [...groups.keys()].map((id) => {
          const doc = id.split("_")[0];
          return {
            id,
            file: `${id}.md`,
            kind: KIND[doc],
            findings: answers.samples.find((s) => s.id === doc)?.findings ?? [],
          };
        }),
      },
      null,
      1,
    )}\n`,
  );
  const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  writeFileSync(
    `eval/results/${date}-ocr-photos.json`,
    `${JSON.stringify({ date, prompt: OCR_PROMPT.version, rows, usage: usage.summary(), failures: usage.failures() }, null, 1)}\n`,
  );
  const rates = rows.map((r) => r.rate as number).sort((a, b) => a - b);
  console.log(
    `\n${rows.length} 组：识别率中位数 ${(rates[Math.floor(rates.length / 2)] * 100).toFixed(1)}%，最低 ${(rates[0] * 100).toFixed(1)}%`,
  );
}
