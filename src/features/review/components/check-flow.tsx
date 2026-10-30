"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Uploader } from "@/features/upload/components/uploader";
import { useReview } from "../use-review";
import { ReviewView } from "./review-view";

// /check 页：上传识别 → 开始检查 → 检查过程和报告。上传区在检查时只是藏起来，
// 点"回到上传"还能看到刚才的页和识别结果，不用重新拍。

export function CheckFlow() {
  const { state, start, cancel } = useReview();
  const [lines, setLines] = useState<string[] | null>(null);

  return (
    <>
      <div className={lines ? "hidden" : undefined}>
        <Uploader
          onStart={(ls) => {
            setLines(ls);
            void start(ls.join("\n"));
          }}
        />
      </div>
      {lines && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                cancel();
                setLines(null);
              }}
            >
              {state.status === "running" ? "停止检查，回到上传" : "回到上传"}
            </Button>
            {state.status !== "running" && (
              <Button variant="outline" onClick={() => void start(lines.join("\n"))}>
                重新检查
              </Button>
            )}
          </div>
          <ReviewView lines={lines} state={state} />
        </div>
      )}
    </>
  );
}
