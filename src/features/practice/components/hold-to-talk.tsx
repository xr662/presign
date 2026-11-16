"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 按住说话（项目方案第 7 节）：用浏览器自带的语音识别，不额外调接口。
// Chrome 的识别走谷歌服务器，国内网络下多半连不上；Edge、Safari 可能可以。用不了时按原因提示改打字。
// 识别出的文字放进输入框，用户看过再点发送，不直接发给 HR：识别错字时可以先改。
// 浏览器没有这个接口就不显示按钮。

type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "没有麦克风权限。可以在浏览器设置里允许，或者直接打字。",
  "service-not-allowed": "这个浏览器不允许语音识别，请直接打字。",
  network:
    "这个浏览器的语音识别连不上服务（国内网络下 Chrome 常见），请直接打字，或换 Edge、Safari 试试。",
  "no-speech": "没听到声音，按住按钮再说一次。",
  "audio-capture": "没有找到麦克风，请直接打字。",
};

const noSubscribe = () => () => {};

export function HoldToTalk({
  disabled,
  onText,
  onError,
}: {
  disabled: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
  const [heard, setHeard] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = "zh-CN";
    r.interimResults = true;
    r.continuous = true;
    let final = "";
    let partial = "";
    r.onresult = (e) => {
      partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else partial += res[0].transcript;
      }
      setHeard(final + partial);
    };
    r.onerror = (e) => {
      // 用户自己松手停止时有的浏览器报 aborted，不算错
      if (e.error !== "aborted") onError(ERRORS[e.error] ?? "语音识别出错了，请直接打字。");
    };
    r.onend = () => {
      rec.current = null;
      setHeard(null);
      const text = (final + partial).trim();
      if (text) onText(text);
    };
    rec.current = r;
    setHeard("");
    try {
      r.start();
    } catch {
      rec.current = null;
      setHeard(null);
      onError("语音识别没有启动，请直接打字。");
    }
  }

  const stop = () => rec.current?.stop();

  if (!supported) return null;
  const listening = heard !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-pressed={listening}
        // 手机上长按会弹出菜单、选中文字，按住说话时都要挡掉
        className={cn("touch-none select-none", listening && "border-ink")}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // 键盘用户：按住空格说话
          if (e.key === " " && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => e.key === " " && stop()}
      >
        {listening ? "松开结束" : "按住说话"}
      </Button>
      {listening && (
        <span role="status" className="text-sm text-ink-2">
          {heard ? `正在听：${heard}` : "正在听"}
        </span>
      )}
    </div>
  );
}
