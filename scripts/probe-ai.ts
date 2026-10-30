// T05 最小样例：直接调真实接口，验证 AI SDK 7 在微信 API 平台上的几项能力，结果写进 PROGRESS。
// 流式、工具调用、结构化输出（两种 JSON 模式）、MCP 客户端、看图识别、思考模式，每项记耗时和 token。
// 不打印密钥。约 10 次请求。
// 用法：node scripts/probe-ai.ts [只跑某几项，如 stream tool]
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createMCPClient } from "@ai-sdk/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { generateText, isStepCount, Output, streamText, tool } from "ai";
import { z } from "zod";
import { LawStore } from "../mcp/labor-law/store.ts";

process.loadEnvFile(".env.local");
const env = (k: string) => process.env[k] ?? "";
const only = process.argv.slice(2);
const want = (name: string) => only.length === 0 || only.includes(name);

const provider = (structured: boolean, extraBody?: Record<string, unknown>) =>
  createOpenAICompatible({
    name: "wechat",
    baseURL: env("LLM_MAIN_BASE_URL"),
    apiKey: env("LLM_MAIN_API_KEY"),
    includeUsage: true,
    supportsStructuredOutputs: structured,
    transformRequestBody: extraBody ? (body) => ({ ...body, ...extraBody }) : undefined,
  });
const model = provider(false)(env("LLM_MAIN_MODEL"));

const usage = (u: { inputTokens?: number; outputTokens?: number }) =>
  `输入 ${u.inputTokens ?? "?"} / 输出 ${u.outputTokens ?? "?"} tokens`;
async function run(name: string, fn: () => Promise<string>) {
  if (!want(name)) return;
  const t0 = performance.now();
  try {
    const msg = await fn();
    console.log(`✓ ${name}（${((performance.now() - t0) / 1000).toFixed(1)}s）${msg}`);
  } catch (e) {
    const err = e as Error & { statusCode?: number; responseBody?: string };
    console.log(
      `× ${name}（${((performance.now() - t0) / 1000).toFixed(1)}s）${err.name}: ${err.message.slice(0, 200)}` +
        (err.statusCode
          ? ` [HTTP ${err.statusCode}] ${(err.responseBody ?? "").slice(0, 200)}`
          : ""),
    );
  }
}

console.log(`模型 ${env("LLM_MAIN_MODEL")}，密钥长度 ${env("LLM_MAIN_API_KEY").length}`);

await run("stream", async () => {
  const t0 = performance.now();
  let first = 0;
  let chunks = 0;
  const r = streamText({ model, prompt: "用两句话说明劳动合同里的试用期是什么。" });
  for await (const d of r.textStream) {
    if (!first) first = performance.now() - t0;
    chunks += d.length > 0 ? 1 : 0;
  }
  return `首字 ${(first / 1000).toFixed(2)}s，${chunks} 段，${usage(await r.usage)}，「${(await r.text).slice(0, 40)}…」`;
});

await run("tool", async () => {
  const calls: string[] = [];
  const r = await generateText({
    model,
    tools: {
      check_probation: tool({
        description: "按劳动合同法第十九条检查试用期是否超过上限",
        inputSchema: z.object({
          termMonths: z.number().describe("劳动合同期限，月"),
          probationMonths: z.number(),
        }),
        execute: async ({ termMonths, probationMonths }) => {
          calls.push(`${termMonths}/${probationMonths}`);
          const limit = termMonths < 3 ? 0 : termMonths < 12 ? 1 : termMonths < 36 ? 2 : 6;
          return { limit, verdict: probationMonths > limit ? "violation" : "ok" };
        },
      }),
    },
    stopWhen: isStepCount(3),
    prompt: "合同期限 2027-07-01 至 2029-06-30，试用期 3 个月。用工具检查后用一句话说结论。",
  });
  return `工具调用 ${calls.length} 次（${calls.join(",")}），${r.steps.length} 步，${usage(r.usage)}，「${r.text.slice(0, 50)}」`;
});

const schema = z.object({
  docType: z.enum(["劳动合同", "三方协议", "录用通知", "实习协议", "其他"]),
  clauses: z.array(z.object({ no: z.string(), topic: z.string() })).min(1),
});
const offer = readFileSync("data/samples/offer.md", "utf8");
for (const structured of [false, true]) {
  await run(`structured-${structured ? "json_schema" : "json_object"}`, async () => {
    const r = await generateText({
      model: provider(structured)(env("LLM_MAIN_MODEL")),
      output: Output.object({ schema }),
      prompt: `判断下面文书的类型，并列出每一条的编号和主题。\n\n${offer}`,
    });
    return `${r.output.docType}，${r.output.clauses.length} 条，${usage(r.usage)}`;
  });
}

await run("mcp", async () => {
  // 进程内起一个最小的 MCP 服务（Streamable HTTP，无状态，只监听本机），提供 get_article
  const store = new LawStore("data/build/law.db");
  const http = createServer(async (req, res) => {
    const server = new McpServer({ name: "labor-law-probe", version: "0.0.1" });
    server.registerTool(
      "get_article",
      {
        description: "按条文 ID 取法条原文，如 ldhtf-19-1（劳动合同法第十九条第一款）",
        inputSchema: { id: z.string() },
      },
      async ({ id }) => {
        const a = store.getArticle(id);
        const text = a
          ? `${a.article.law_short}${a.article.label}：${a.paragraph?.text ?? a.article.text}`
          : "没有这个条文";
        return { content: [{ type: "text", text }] };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  const client = await createMCPClient({ transport: { type: "http", url } });
  try {
    const tools = await client.tools();
    const r = await generateText({
      model,
      tools,
      stopWhen: isStepCount(3),
      prompt: "用 get_article 查条文 ldhtf-19-1，然后原样告诉我它规定的三档试用期上限。",
    });
    const called = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    return `工具 ${Object.keys(tools).join(",")}；调用 ${called.join(",") || "无"}；${usage(r.usage)}；回答含"六个月"：${r.text.includes("六个月")}`;
  } finally {
    await client.close();
    http.close();
    store.close();
  }
});

await run("vision", async () => {
  const img = readFileSync("test-results/shots/print-labor.png");
  const r = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "把图片里的文字逐行原样抄出来，不要改写，不要加说明。" },
          { type: "file", data: img, mediaType: "image/png" },
        ],
      },
    ],
  });
  // 和原文按字比：原文里每个字在识别结果里出现的比例（粗略，T06 再做逐行对齐）
  const truth = readFileSync("data/samples/labor.md", "utf8").replace(/\s/g, "").slice(0, 600);
  const got = r.text.replace(/\s/g, "");
  let hit = 0;
  for (let i = 0; i + 4 <= truth.length; i += 4) if (got.includes(truth.slice(i, i + 4))) hit++;
  return `识别 ${got.length} 字，原文前 600 字按 4 字片段命中 ${((hit / Math.floor(truth.length / 4)) * 100).toFixed(0)}%，${usage(r.usage)}`;
});

for (const [name, body] of [
  ["thinking-enabled", { thinking: { type: "enabled" } }],
  ["reasoning-effort", { reasoning_effort: "high" }],
] as const) {
  await run(name, async () => {
    const r = await generateText({
      model: provider(false, body)(env("LLM_MAIN_MODEL")),
      prompt: "劳动合同期限 2027-07-01 至 2030-06-29，试用期上限是几个月？只回答数字。",
    });
    return `推理文本 ${r.reasoningText?.length ?? 0} 字，${usage(r.usage)}，回答「${r.text.trim().slice(0, 20)}」`;
  });
}
