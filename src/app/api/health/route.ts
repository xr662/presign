// 健康检查（项目方案第 11 节）：部署后的自动检查（deploy/smoke.sh）和评审期间巡检用。
// 不用登录，不调模型（不花额度），只回状态，不回地址、密钥这类配置内容。
//   mcp：连本机的法规服务，调一次 lookup_min_wage（只查表，不跑向量），能返回就算正常
//   models：配了几个模型角色，只数个数
//   login：会话密钥和账号是否都配了；没配的话谁也登录不了
import { connection } from "next/server";
import { rolesFromEnv } from "@/lib/ai/config";
import { accountsFromEnv } from "@/lib/auth/password";
import { connectMcp } from "@/lib/review/tools";

const MCP_TIMEOUT_MS = 5_000;

async function checkMcp(): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), MCP_TIMEOUT_MS),
  );
  try {
    const tools = await Promise.race([
      connectMcp(process.env.MCP_URL || "http://127.0.0.1:3101/mcp"),
      timeout,
    ]);
    try {
      await Promise.race([tools.call("lookup_min_wage", { province: "上海市" }), timeout]);
      return true;
    } finally {
      await tools.close().catch(() => {});
    }
  } catch {
    return false;
  }
}

export async function GET() {
  // 每次请求现查；不让构建时把某一刻的结果固定下来
  await connection();
  const t0 = Date.now();
  const mcp = await checkMcp();
  const models = rolesFromEnv().length;
  const login = Boolean(process.env.SESSION_SECRET) && accountsFromEnv().size > 0;
  const ok = mcp && models > 0 && login;
  return Response.json(
    { ok, mcp: mcp ? "ok" : "down", models, login, ms: Date.now() - t0 },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
