// 合同检查（项目方案第 4 节）：收识别好的全文，用 SSE 推送审查流程的每一步。
// 服务端不保存合同：全文只在这次请求的内存里，日志里只有次数、token 和耗时。
// 浏览器断开（关页面、点取消）时 req.signal 中止，审查流程停在当前步骤。
import { z } from "zod";
import { ai } from "@/lib/ai";
import { checkModelRequest } from "@/lib/auth/guard";
import type { ReviewEvent } from "@/lib/review/events";
import { runReview } from "@/lib/review/run";
import { connectMcp, type Tools } from "@/lib/review/tools";

// 6 页合同识别出来一般不到 1 万字，2 万字是上限，再长的多半不是一份合同
const schema = z.object({ text: z.string().trim().min(20).max(20_000) });

const fail = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const denied = checkModelRequest(req);
  if (denied) return fail(denied.status, denied.error, denied.message);

  let text: string;
  try {
    const body = schema.safeParse(await req.json());
    if (!body.success)
      return fail(400, "bad_request", "合同文字太短或超过 2 万字，请检查上传的内容");
    text = body.data.text;
  } catch {
    return fail(400, "bad_request", "没有收到合同文字");
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ReviewEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // 浏览器已经断开，后面的事件丢掉
        }
      };
      let tools: Tools | null = null;
      try {
        tools = await connectMcp(process.env.MCP_URL || "http://127.0.0.1:3101/mcp");
      } catch {
        send({
          type: "error",
          at: 0,
          code: "mcp_unavailable",
          message: "法规服务没有响应，暂时不能检查。可以先看示例合同的报告。",
        });
        controller.close();
        return;
      }
      try {
        await runReview({ text }, { ai: ai(), tools }, send, { signal: req.signal });
      } finally {
        await tools.close().catch(() => {});
        try {
          controller.close();
        } catch {
          // 已经关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      // 部署时前面有 Caddy，告诉反向代理不要攒着整段响应再发
      "X-Accel-Buffering": "no",
    },
  });
}
