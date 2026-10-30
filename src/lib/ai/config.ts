// 模型配置全部来自环境变量，换供应商不改代码（项目方案第 9 节）。
// 三个角色：main 主模型，alt 复核模型，fallback 备用（11 月中旬换成 DeepSeek 官方 key 时用）。
// 某个角色的 key、地址、模型名缺一项，就当它不存在，调用时自动用下一个。

export type Role = "main" | "alt" | "fallback";
export type ReasoningEffort = "low" | "medium" | "high";

export type RoleConfig = {
  role: Role;
  baseURL: string;
  apiKey: string;
  model: string;
  // 微信 API 平台上只有 reasoning_effort 能打开思考模式，thinking 参数没有效果（10-30 实测）
  reasoningEffort?: ReasoningEffort;
};

export type Limits = {
  dailyTokens: number;
  // 平台限额是 5 小时 1200 次、7 天 9000 次、30 天 18000 次，这里各留一点余量
  requests5h: number;
  requests7d: number;
  requests30d: number;
};

// 每一步用哪个角色优先。自检和谈判练习用复核角色，其余用主模型；都失败再往后排
export type Purpose =
  | "ocr"
  | "extract"
  | "plan"
  | "execute"
  | "verify"
  | "report"
  | "practice"
  | "rewrite"
  | "rerank"
  | "probe";

const ORDER: Record<Purpose, Role[]> = {
  ocr: ["main", "alt", "fallback"],
  rewrite: ["main", "alt", "fallback"],
  extract: ["main", "alt", "fallback"],
  plan: ["main", "alt", "fallback"],
  execute: ["main", "alt", "fallback"],
  report: ["main", "alt", "fallback"],
  rerank: ["main", "alt", "fallback"],
  probe: ["main", "alt", "fallback"],
  verify: ["alt", "main", "fallback"],
  practice: ["alt", "main", "fallback"],
};

type Env = Record<string, string | undefined>;

export function rolesFromEnv(env: Env = process.env): RoleConfig[] {
  return (["main", "alt", "fallback"] as const).flatMap((role) => {
    const p = `LLM_${role.toUpperCase()}_`;
    const apiKey = env[`${p}API_KEY`]?.trim();
    const baseURL = env[`${p}BASE_URL`]?.trim();
    const model = env[`${p}MODEL`]?.trim();
    if (!apiKey || !baseURL || !model) return [];
    const effort = env[`${p}REASONING_EFFORT`]?.trim();
    const reasoningEffort =
      effort === "low" || effort === "medium" || effort === "high" ? effort : undefined;
    return [{ role, apiKey, baseURL, model, reasoningEffort }];
  });
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function limitsFromEnv(env: Env = process.env): Limits {
  return {
    dailyTokens: num(env.DAILY_TOKEN_BUDGET, 3_000_000),
    requests5h: num(env.PLATFORM_REQUESTS_5H, 1100),
    requests7d: num(env.PLATFORM_REQUESTS_7D, 8500),
    requests30d: num(env.PLATFORM_REQUESTS_30D, 17000),
  };
}

// 每一步的思考强度，默认都不开。
// 10-30 T05 实测：抽取一份劳动合同，思考开 high 后输出从 129 涨到 4148 tokens，耗时从 4.3 秒到 42.5 秒，
// 结果一样。当时定的是自检开 high、报告开 medium。T09 把整套审查流程跑起来后改成都不开：
//   自检开 high：一次核对两份请求 80 秒都没返回，整次检查撞上 120 秒时限；
//   报告开 medium：3 条批注写了 48 秒、输出 6089 tokens；
//   抽取开 low：四份示例合同全部 60 秒没返回。
// 都不开时一份合同 27~75 秒走完（T09 评测）。质量靠程序检查兜底（出处核对、依据限定、报告数字核对）。
// 环境变量 REASONING_<用途>（如 REASONING_VERIFY=low、REASONING_EXTRACT=high）可以单独打开。
const PURPOSE_EFFORT: Partial<Record<Purpose, ReasoningEffort>> = {};

export function effortFor(
  purpose: Purpose,
  r: RoleConfig,
  env: Env = process.env,
): ReasoningEffort | undefined {
  const v = env[`REASONING_${purpose.toUpperCase()}`]?.trim();
  if (v === "off") return undefined;
  if (v === "low" || v === "medium" || v === "high") return v;
  return PURPOSE_EFFORT[purpose] ?? r.reasoningEffort;
}

export function chainFor(purpose: Purpose, roles: RoleConfig[]): RoleConfig[] {
  return ORDER[purpose].flatMap((r) => roles.filter((x) => x.role === r));
}

// 用接口地址的主机名区分供应商：同一平台上的几个角色共用一份请求次数
export const providerKey = (r: RoleConfig) => new URL(r.baseURL).host;
