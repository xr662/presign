// 图片识别：浏览器压缩、本地打码后的单页图片 → 模型逐行抄出文字。
// 只返回文字，框线由浏览器本地 OCR 提供，两边在前端对齐（src/features/upload/lib/align.ts）。
// 服务端不保存图片和识别结果，日志里只有次数、token 和耗时。
import { z } from "zod";
import { ai, aiErrorCode, type BudgetExceededError } from "@/lib/ai";
import { checkModelRequest } from "@/lib/auth/guard";
import { OCR_CONTINUE_NOTE, OCR_PROMPT } from "@/prompts/ocr";

export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const schema = z.object({ lines: z.array(z.string()).max(200) });

// 只认文件头，不信浏览器报的类型
function sniff(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (tag(0) === "RIFF" && tag(8) === "WEBP") return "image/webp";
  return null;
}

const fail = (status: number, error: string, message: string, extra: object = {}) =>
  Response.json({ error, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });

export async function POST(req: Request) {
  const denied = checkModelRequest(req);
  if (denied) return fail(denied.status, denied.error, denied.message);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "bad_request", "没有收到图片");
  }
  const file = form.get("image");
  if (!(file instanceof File)) return fail(400, "bad_request", "没有收到图片");
  if (file.size > MAX_IMAGE_BYTES)
    return fail(413, "too_large", "图片超过 1.5MB，请重新选择或换一张小一点的");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = sniff(bytes);
  if (!mediaType) return fail(415, "bad_type", "只支持 JPG、PNG、WebP 格式的图片");
  const isContinuation = form.get("part") === "continue";

  const t0 = Date.now();
  try {
    const out = await ai().generateObject("ocr", schema, {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: isContinuation ? `${OCR_PROMPT.text}\n${OCR_CONTINUE_NOTE}` : OCR_PROMPT.text,
            },
            { type: "file", data: bytes, mediaType },
          ],
        },
      ],
      abortSignal: AbortSignal.timeout(60_000),
    });
    return Response.json(
      { lines: out.lines, prompt: OCR_PROMPT.version, ms: Date.now() - t0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const code = aiErrorCode(e);
    if (code === "budget_exceeded")
      return fail(
        429,
        "budget_exceeded",
        `今天的识别次数用完了，北京时间 ${clock((e as BudgetExceededError).resetAt)} 后恢复。可以先看示例合同的报告。`,
        { resetAt: (e as BudgetExceededError).resetAt },
      );
    if (code === "bad_output")
      return fail(
        502,
        "bad_output",
        "这一页没有识别出来。可以再试一次；还不行的话，换一张更清楚的照片，或者直接粘贴文字。",
      );
    if (code === "all_failed" || code === "no_model")
      return fail(503, "unavailable", "识别服务暂时连不上，请过几分钟再试，或者直接粘贴文字。");
    if (e instanceof Error && e.name === "TimeoutError")
      return fail(504, "timeout", "识别超过 60 秒还没有结果，请再试一次。");
    throw e;
  }
}
