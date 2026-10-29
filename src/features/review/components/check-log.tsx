import { cn } from "@/lib/utils";

// 检查记录：像一张工作底稿，每行是一次真实操作（识别、调用规则、查法条）。
// 这是评分里"AI 思考状态可视化"的落点，所以只写做了什么，不写"思考中"。

export type LogEntry = {
  at: string; // 相对开始的秒数，如 "4.2s"
  text: string;
  state: "done" | "running" | "failed";
  detail?: string; // 工具调用的输入输出，展开查看
};

export function CheckLog({ entries, className }: { entries: LogEntry[]; className?: string }) {
  return (
    <ol className={cn("divide-y divide-line rounded-md border border-line bg-card", className)}>
      {entries.map((e, i) => (
        <li key={i} className="flex gap-3 px-3 py-2 text-sm">
          <span className="w-12 shrink-0 text-right text-xs leading-5 text-pencil tabular-nums">
            {e.at}
          </span>
          <span className="flex-1 leading-5">
            <span
              className={cn(
                e.state === "running" && "text-ink",
                e.state === "done" && "text-ink-2",
                e.state === "failed" && "text-red-pen",
              )}
            >
              {e.state === "running" && <span className="sr-only">进行中：</span>}
              {e.state === "failed" && <span className="sr-only">失败：</span>}
              {e.text}
            </span>
            {e.detail && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-pencil select-none">
                  输入与输出
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-sm bg-paper-2 p-2 text-xs leading-5 whitespace-pre-wrap">
                  {e.detail}
                </pre>
              </details>
            )}
          </span>
          {e.state === "running" && (
            // 进行中用一条细进度线，不用跳动的三个点
            <span className="mt-2 h-0.5 w-6 shrink-0 animate-pulse rounded bg-ink/40" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
