"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Uploader } from "@/features/upload/components/uploader";
import { useReview } from "../use-review";
import { ReviewView } from "./review-view";

// /check 页：上传识别 → 开始检查 → 检查过程和报告。上传区在检查时只是藏起来，
// 点"回到上传"还能看到刚才的页和识别结果，不用重新拍。
// 识别和检查都要调模型，要评审账号登录；没登录时先提示，免得拍完照片才发现用不了。

type Session = { user: string | null; required: boolean };

function LoginNotice() {
  return (
    <div className="rounded-md border border-line bg-card p-4 text-sm leading-6">
      <p>识别和检查要用评审账号登录（本站只给评审使用，控制模型接口的费用）。</p>
      <p className="mt-2 flex flex-wrap gap-3">
        <Link href="/login?next=/check" className="font-medium underline">
          登录
        </Link>
        <Link href="/samples" className="underline">
          先看示例合同的检查过程
        </Link>
      </p>
    </div>
  );
}

export function CheckFlow() {
  const { state, start, cancel } = useReview();
  const [lines, setLines] = useState<string[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json() as Promise<Session>)
      .then(setSession)
      .catch(() => setSession({ user: null, required: true }));
  }, []);

  const needLogin = (session?.required && !session.user) || state.error?.code === "login_required";

  return (
    <div className="space-y-6">
      {needLogin && <LoginNotice />}
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
    </div>
  );
}
