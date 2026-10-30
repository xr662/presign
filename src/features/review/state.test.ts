// 检查页 reducer 和定位：把录好的四份示例事件整段喂进去，最终状态要和 done 事件对得上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReviewEvent } from "@/lib/review/events";
import { locateLines } from "./locate";
import { initialReview, reduceReview, visibleFindings } from "./state";

const load = (id: string) =>
  JSON.parse(readFileSync(`public/recordings/${id}.json`, "utf8")) as {
    text: string;
    events: ReviewEvent[];
  };

describe("reducer 回放录像", () => {
  for (const id of ["labor", "tripartite", "offer", "internship"]) {
    it(`${id}：结束后计数和 done 一致，没有一直"进行中"的记录，批注都能在合同里定位`, () => {
      const rec = load(id);
      const s = rec.events.reduce(reduceReview, reduceReview(initialReview, { type: "start" }));
      const done = rec.events.at(-1) as Extract<ReviewEvent, { type: "done" }>;
      expect(s.status).toBe("done");
      expect(s.summary).toBe(done.summary);
      const counted = Object.fromEntries(Object.keys(done.counts).map((v) => [v, 0]));
      for (const f of s.findings) counted[f.verdict]++;
      expect(counted).toEqual(done.counts);
      expect(s.log.some((x) => x.state === "running")).toBe(false);
      const lines = rec.text.split(/\r?\n/).filter((l) => l.trim());
      for (const f of visibleFindings(s))
        if (f.quote) expect(locateLines(lines, f.quote).length, f.quote).toBeGreaterThan(0);
    });
  }

  it("出错后 done：状态是 error，进行中的行标成失败", () => {
    let s = reduceReview(initialReview, { type: "start" });
    s = reduceReview(s, { type: "step", at: 0, step: "extract", state: "running", text: "抽取" });
    s = reduceReview(s, { type: "error", at: 5, code: "deadline", message: "超过 120 秒" });
    s = reduceReview(s, {
      type: "done",
      at: 6,
      summary: "没有找到可以检查的条款。",
      counts: { violation: 0, likely_violation: 0, needs_review: 0, advice: 0, ok: 0, unknown: 0 },
      modelCalls: 1,
    });
    expect(s.status).toBe("error");
    expect(s.log.map((x) => x.state)).toEqual(["failed", "failed"]);
  });
});

describe("在合同里找原文", () => {
  const lines = [
    "第三条 试用期",
    "劳动合同期限自 2027 年 7 月 1 日起至 2029 年 6 月 30 日止，其中试用期 3 个月。",
    "第四条",
  ];
  it("片段在一行里、找不到、没有片段", () => {
    expect(locateLines(lines, "其中试用期 3 个月")).toEqual([1]);
    expect(locateLines(lines, "合同里没有的话")).toEqual([]);
    expect(locateLines(lines, null)).toEqual([]);
  });

  it("识别时一句话断成两行：两行都标出来", () => {
    const split = [
      "第七条 违约金",
      "乙方在合同期内提前离职的，",
      "应向甲方支付违约金人民币 20000 元。",
    ];
    expect(
      locateLines(split, "乙方在合同期内提前离职的，应向甲方支付违约金人民币 20000 元"),
    ).toEqual([1, 2]);
  });
});
