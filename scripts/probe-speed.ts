// 模型接口速度：首字时间（排队 + 连接 + 模型开始生成）和生成速度（每秒输出多少 token）分开量。
// 一次检查的耗时 ≈ 每次调用的首字时间 × 串行调用次数 + 输出 token 数 ÷ 生成速度，
// 两项分开看才知道慢在哪：首字慢是平台排队，生成慢是模型或平台算力。
// 换供应商（任务书 U6，11 月中旬换 DeepSeek 官方 key）后再跑一次对比。
// 每个角色 3 次请求，不打印密钥。用法：node scripts/probe-speed.ts [--runs 3]
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { rolesFromEnv } from "../src/lib/ai/config.ts";

process.loadEnvFile(".env.local");
const argv = process.argv.slice(2);
const runs = argv.includes("--runs") ? Number(argv[argv.indexOf("--runs") + 1]) : 3;

// 要一段长度固定的输出，生成速度才好比；内容和合同检查无关，避免缓存或审核影响
const PROMPT =
  "按顺序写出 1 到 120 的中文大写数字，用顿号隔开，只输出这些数字，不要任何说明。例如：壹、贰、叁";

for (const r of rolesFromEnv()) {
  const model = createOpenAICompatible({
    name: r.role,
    baseURL: r.baseURL,
    apiKey: r.apiKey,
    includeUsage: true,
  })(r.model);
  console.log(`${r.role}：${new URL(r.baseURL).host} ${r.model}`);
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    let first = 0;
    try {
      const s = streamText({ model, prompt: PROMPT, maxRetries: 0, timeout: 60_000 });
      for await (const d of s.textStream) if (!first && d) first = performance.now() - t0;
      const total = performance.now() - t0;
      const out = (await s.usage).outputTokens ?? 0;
      const genSec = (total - first) / 1000;
      console.log(
        `  第 ${i + 1} 次：首字 ${(first / 1000).toFixed(1)} 秒，输出 ${out} tokens 用 ${genSec.toFixed(1)} 秒，` +
          `生成速度 ${genSec > 0 ? (out / genSec).toFixed(0) : "?"} tokens/秒，合计 ${(total / 1000).toFixed(1)} 秒`,
      );
    } catch (e) {
      console.log(`  第 ${i + 1} 次：${(e as Error).name}，${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
    }
  }
}
