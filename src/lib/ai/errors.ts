// 接入层自己抛的错误。界面按 code 显示原因和恢复时间，不显示供应商返回的原始报错。
// 字段写成普通属性（不用构造函数参数属性），因为 mcp/ 和 scripts/ 由 Node 直接运行 .ts。

export type BudgetReason = "daily_tokens" | "requests_5h" | "requests_7d" | "requests_30d";

export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  readonly reason: BudgetReason;
  readonly resetAt: number;
  constructor(reason: BudgetReason, resetAt: number) {
    super(`用量已到上限：${reason}，${new Date(resetAt).toISOString()} 后恢复`);
    this.name = "BudgetExceededError";
    this.reason = reason;
    this.resetAt = resetAt;
  }
}

export class NoModelAvailableError extends Error {
  readonly code = "no_model";
  constructor() {
    super("没有可用的模型：环境变量里没有配置任何一组完整的 LLM_*_BASE_URL、API_KEY、MODEL");
    this.name = "NoModelAvailableError";
  }
}

export class AllModelsFailedError extends Error {
  readonly code = "all_failed";
  readonly tried: string[];
  readonly lastError: unknown;
  constructor(tried: string[], lastError: unknown) {
    super(`模型调用失败，已依次尝试 ${tried.join("、")}`);
    this.name = "AllModelsFailedError";
    this.tried = tried;
    this.lastError = lastError;
  }
}

export class StructuredOutputError extends Error {
  readonly code = "bad_output";
  readonly attempts: number;
  constructor(attempts: number) {
    super(`模型连续 ${attempts} 次没有按格式输出`);
    this.name = "StructuredOutputError";
    this.attempts = attempts;
  }
}

export type AiErrorCode = "budget_exceeded" | "no_model" | "all_failed" | "bad_output";

/** 按 code 判断错误类型。比 instanceof 稳：模块被打包或测试替换成两份时 instanceof 会失效 */
export function aiErrorCode(e: unknown): AiErrorCode | null {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "budget_exceeded" ||
    code === "no_model" ||
    code === "all_failed" ||
    code === "bad_output"
    ? code
    : null;
}
