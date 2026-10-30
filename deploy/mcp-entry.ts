// 部署用的 MCP 服务入口：deploy/pack.sh 用 esbuild 从这里打成单文件 server.mjs。
// server.ts 自己只在以 mcp/labor-law/server.ts 这个路径运行时才启动，打包后文件名变了，所以单独写一个入口。
import { startHttp } from "../mcp/labor-law/server.ts";

const port = Number(process.env.MCP_PORT) || 3101;
await startHttp(port);
console.error(`劳动法规 MCP 服务：http://127.0.0.1:${port}/mcp`);
