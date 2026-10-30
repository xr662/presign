// MCP 服务测试：在随机端口起 HTTP 服务，用官方 MCP 客户端列工具、调工具。
// 用不带向量的临时库（几秒建好），search_law 只走全文检索。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let client: Client;
let close: () => void;
let closeStore: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcp-"));
  execFileSync(process.execPath, [
    "scripts/corpus/build-db.ts",
    "--no-vectors",
    "--out",
    join(dir, "law.db"),
  ]);
  process.env.LAW_DB_PATH = join(dir, "law.db");
  const server = await import("./server.ts");
  closeStore = server.closeStore;
  const { startHttp } = server;
  const http = await startHttp(0);
  close = () => http.close();
  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`),
    ),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  close?.();
  closeStore?.();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { ...JSON.parse(content[0].text), isError: r.isError };
};

describe("MCP 服务", () => {
  it("列出 12 个工具，都标了只读", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_deposit",
      "check_non_compete",
      "check_penalty",
      "check_probation",
      "check_probation_wage",
      "check_required_clauses",
      "check_social_insurance",
      "check_tripartite",
      "check_unilateral_terms",
      "get_article",
      "lookup_min_wage",
      "search_law",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("get_article 按款取原文，带版本和来源", async () => {
    const r = await call("get_article", { id: "ldhtf-19-1" });
    expect(r.label).toBe("劳动合同法第十九条第一款");
    expect(r.text).toMatch(/^劳动合同期限三个月以上不满一年的/);
    expect(r.source).toMatch(/^https?:/);
  });

  it("get_article 不存在的 ID 返回错误", async () => {
    expect((await call("get_article", { id: "ldhtf-999" })).isError).toBe(true);
  });

  it("search_law 用法条原话能查到", async () => {
    const r = await call("search_law", { query: "试用期不得超过", top_k: 3 });
    expect(r.hits[0].id).toBe("ldhtf-19");
    expect(r.hits[0].text).toMatch(/试用期/);
  });

  it("check_probation：差一天满三年的合同试用期 6 个月违法", async () => {
    const r = await call("check_probation", {
      term: { kind: "fixed", start: "2027-07-01", end: "2030-06-29" },
      probation: { months: 6 },
    });
    expect(r.findings[0]).toMatchObject({ rule: "R01", verdict: "violation" });
  });

  it("check_probation_wage 自己查最低工资：上海 2600 元违法", async () => {
    const r = await call("check_probation_wage", {
      probationWage: 2600,
      agreedWage: 6000,
      city: "上海",
    });
    expect(r.findings[0]).toMatchObject({ rule: "R05", verdict: "violation" });
    expect(r.findings[0].steps.join()).toMatch(/2740/);
  });

  it("check_probation_wage：档位没核实的城市把各档返回给模型", async () => {
    const r = await call("check_probation_wage", {
      probationWage: 2500,
      agreedWage: 3000,
      city: "石家庄",
    });
    expect(r.minWage.kind).toBe("need_tier");
  });

  it("输入不合规时报参数错误，不进规则", async () => {
    const r = await client.callTool({
      name: "check_social_insurance",
      arguments: { waived: "是" },
    });
    expect(r.isError).toBe(true);
  });
});
