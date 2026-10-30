// 审查流程调 MCP 规则工具的接口。线上走 Streamable HTTP 连本机的劳动法规 MCP 服务（只监听 127.0.0.1）；
// 评测脚本和测试用内存通道直接连 buildServer()，跑的是同一套工具处理函数。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Candidate, SearchFn } from "./retrieve.ts";

export type Tools = {
  /** 调一个工具，返回工具输出的 JSON；工具报错时抛 ToolError */
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export class ToolError extends Error {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`${tool}：${message}`);
    this.name = "ToolError";
    this.tool = tool;
  }
}

export function toolsFromClient(client: Client): Tools {
  return {
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { type: string; text?: string }[]).find(
        (c) => c.type === "text",
      )?.text;
      if (r.isError) throw new ToolError(name, text ?? "工具返回错误");
      return text ? JSON.parse(text) : null;
    },
    close: () => client.close(),
  };
}

/** 连 MCP 服务。服务是无状态的，每次检查连一次，检查结束关掉 */
export async function connectMcp(url: string): Promise<Tools> {
  const client = new Client({ name: "presign-review", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return toolsFromClient(client);
}

/** 用 search_law 实现检索流程要的 SearchFn：原句作 query，改写作 rewrites */
export function searchViaTools(tools: Tools): SearchFn {
  return async (queries, k) => {
    const [query, ...rewrites] = queries;
    const r = (await tools.call("search_law", {
      query: query.slice(0, 200),
      rewrites: rewrites.slice(0, 3).map((q) => q.slice(0, 200)),
      top_k: Math.min(k, 20),
    })) as { hits: Candidate[] };
    return r.hits;
  };
}
