// /api/ocr 的输入检查和错误提示。模型用模拟的，不发真实请求。
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("@/lib/ai", async () => {
  const errors = await import("@/lib/ai/errors");
  return { ...errors, ai: () => ({ generateObject }) };
});
const { BudgetExceededError, StructuredOutputError } = await import("@/lib/ai/errors");
const { POST, MAX_IMAGE_BYTES } = await import("./route");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/ocr", {
    method: "POST",
    body,
    headers: { host: "localhost:3000", ...headers },
  });
const form = (data: Uint8Array<ArrayBuffer>, name = "page.jpg", type = "image/jpeg") => {
  const f = new FormData();
  f.set("image", new File([data], name, { type }));
  return f;
};

// 用花括号：beforeEach 返回函数时 vitest 会把它当成测试结束后的清理函数来调用
beforeEach(() => {
  generateObject.mockReset();
});

describe("/api/ocr", () => {
  it("正常识别返回文字行和提示词版本", async () => {
    generateObject.mockResolvedValue({ lines: ["劳动合同书", "第一条"] });
    const res = await POST(req(form(JPEG)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toEqual(["劳动合同书", "第一条"]);
    expect(body.prompt).toBe("ocr-v1");
    // 图片作为 file 部分发给模型，类型按文件头判断
    const content = generateObject.mock.calls[0][2].messages[0].content;
    expect(content[1]).toMatchObject({ type: "file", mediaType: "image/jpeg" });
  });

  it("文件头不是图片时拒绝，不调模型", async () => {
    const res = await POST(
      req(form(new Uint8Array(new TextEncoder().encode("<script>alert(1)</script>")), "a.jpg")),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).message).toMatch(/JPG、PNG、WebP/);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("超过 1.5MB 拒绝", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    const res = await POST(req(form(big)));
    expect(res.status).toBe(413);
  });

  it("其他网站发来的请求拒绝", async () => {
    const res = await POST(req(form(JPEG), { origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("额度用完时写明恢复时间（北京时间）", async () => {
    generateObject.mockRejectedValue(
      new BudgetExceededError("daily_tokens", Date.UTC(2026, 9, 30, 16)),
    );
    const res = await POST(req(form(JPEG)));
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/北京时间 00:00 后恢复/);
  });

  it("识别结果格式不对时给出可以怎么做", async () => {
    generateObject.mockRejectedValue(new StructuredOutputError(2));
    const res = await POST(req(form(JPEG)));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/粘贴文字/);
  });

  it("续识别下半页时提示词里带上说明", async () => {
    generateObject.mockResolvedValue({ lines: ["第七条"] });
    const f = form(JPEG);
    f.set("part", "continue");
    await POST(req(f));
    expect(generateObject.mock.calls[0][2].messages[0].content[0].text).toMatch(/下半部分/);
  });
});
