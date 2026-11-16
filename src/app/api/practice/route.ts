// 谈判练习（项目方案第 7 节）。一个接口三种用法：
//   hr：HR 回一句，流式返回纯文本，边生成边显示
//   coach：教练提示卡，结构化输出，过程序检查后返回 JSON
//   debrief：结束后的复盘打分，结构化输出，过程序检查后返回 JSON
// 服务端不存对话：每次由浏览器把场景、历史和本轮输入一起发来，这里只在内存里用一次。
import { z } from "zod";
import {
  CUT_MARK,
  MAX_PICK,
  MAX_ROUNDS,
  STYLES,
  type Coach,
  type Debrief,
} from "@/features/practice/scenario";
import { ai, takePracticeTurn } from "@/lib/ai";
import { checkModelRequest } from "@/lib/auth/guard";
import {
  checkCoach,
  checkDebrief,
  coachMaterial,
  hrMaterial,
  screenInput,
  transcript,
} from "@/lib/practice/practice";
import { COACH_PROMPT, DEBRIEF_PROMPT, HR_PROMPT } from "@/prompts/practice";

// 场景由浏览器发来，长度都设上限：材料会进提示词，不能让一个请求塞进几万字
const finding = z.object({
  id: z.string().max(20),
  verdict: z.enum(["violation", "likely_violation", "needs_review", "advice"]),
  clause: z.string().max(40).nullable(),
  quote: z.string().max(400).nullable(),
  title: z.string().max(200),
  conclusion: z.string().max(400),
  revision: z.object({ before: z.string().max(400), after: z.string().max(400) }).nullable(),
  talkingPoint: z.string().max(300).nullable(),
  basis: z.array(z.object({ label: z.string().max(60), text: z.string().max(500) })).max(3),
});

const schema = z.object({
  mode: z.enum(["hr", "coach", "debrief"]),
  docKind: z.string().max(20),
  style: z.enum(["soft", "formal", "tough"]),
  findings: z.array(finding).min(1).max(MAX_PICK),
  history: z
    .array(z.object({ role: z.enum(["me", "hr"]), text: z.string().trim().min(1).max(600) }))
    .max(MAX_ROUNDS * 2 + 1),
});

const coachSchema = z.object({
  hint: z.string(),
  findingId: z.string().nullable(),
  tone: z.enum(["steady", "too_soft", "too_hard"]).nullable(),
});

const debriefSchema = z.object({
  items: z.array(
    z.object({
      key: z.enum(["basis", "revision", "tone"]),
      score: z.number(),
      comment: z.string(),
      quote: z.string().nullable(),
    }),
  ),
  summary: z.string(),
});

// 平台有请求挂住不返回（交接文档第 8 节），每次调用都设时限和对冲
const CALL = { timeoutMs: 20_000, hedgeMs: 8_000 };
const HR_TIMEOUT_MS = 30_000;

const fail = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const guard = checkModelRequest(req);
  if (!guard.ok) return fail(guard.status, guard.error, guard.message);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "bad_request", "练习的内容不完整，请回到报告重新开始");
  const { mode, docKind, style, findings, history } = parsed.data;

  try {
    if (mode === "hr") {
      const last = history.at(-1);
      if (!last || last.role !== "me") return fail(400, "bad_request", "先说一句再等 HR 回复");
      const blocked = screenInput(last.text);
      if (blocked) return fail(400, "blocked", blocked);
      if (history.filter((t) => t.role === "me").length > MAX_ROUNDS)
        return fail(
          400,
          "too_long",
          `一次练习最多 ${MAX_ROUNDS} 轮，点"结束并复盘"看看这次谈得怎样`,
        );
      const quota = takePracticeTurn(guard.user);
      if (!quota.ok)
        return fail(
          429,
          "daily_limit",
          `这个账号今天的 ${quota.limit} 轮练习已经用完，北京时间明天 0 点恢复。`,
        );

      const { textStream } = ai().stream("practice", {
        system: HR_PROMPT.system(docKind, style, hrMaterial(findings)),
        messages: history.map((t) => ({
          role: t.role === "me" ? ("user" as const) : ("assistant" as const),
          content: t.text,
        })),
        maxOutputTokens: 300,
        abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(HR_TIMEOUT_MS)]),
      });
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const d of textStream) controller.enqueue(enc.encode(d));
          } catch {
            // 出错（没吐字就失败，或说到一半断了）：末尾补 CUT_MARK，浏览器提示没回应或没说完
            controller.enqueue(enc.encode(CUT_MARK));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const data = [
      "<检查结果>",
      coachMaterial(findings),
      "</检查结果>",
      "<对话>",
      // 开场白是 HR 说的第一句，教练和复盘要看到完整对话
      transcript([
        { role: "hr", text: STYLES.find((x) => x.id === style)?.opener ?? "" },
        ...history,
      ]),
      "</对话>",
    ].join("\n");

    if (mode === "coach") {
      const c = (await ai().generateObject("practice", coachSchema, {
        system: COACH_PROMPT.system,
        prompt: data,
        abortSignal: req.signal,
        ...CALL,
      })) as Coach;
      return Response.json(checkCoach(c, findings), { headers: { "Cache-Control": "no-store" } });
    }

    if (!history.some((t) => t.role === "me"))
      return fail(400, "bad_request", "还没说话，没有可以复盘的内容");
    const d = (await ai().generateObject("practice", debriefSchema, {
      system: DEBRIEF_PROMPT.system,
      prompt: data,
      abortSignal: req.signal,
      ...CALL,
    })) as Debrief;
    return Response.json(checkDebrief(d, history), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(502, "model_failed", "模型这次没有回应，请再试一次。");
  }
}
