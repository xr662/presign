"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { SAMPLES } from "@/features/review/samples";
import { initialReview, reduceReview, visibleFindings } from "@/features/review/state";
import { VERDICT_STYLE } from "@/features/review/verdict";
import type { ReviewEvent } from "@/lib/review/events";
import { screenInput } from "@/lib/practice/practice";
import { cn } from "@/lib/utils";
import { HoldToTalk } from "./hold-to-talk";
import {
  CUT_MARK,
  DEBRIEF_LABELS,
  MAX_PICK,
  MAX_ROUNDS,
  STYLES,
  parseScenario,
  readScenarioRaw,
  scenarioFromFindings,
  type Coach,
  type Debrief,
  type PracticeFinding,
  type PracticeStyle,
  type Scenario,
  type Turn,
} from "../scenario";

// 谈判练习页（项目方案第 2、7 节）：选要谈的条款和 HR 风格 → 对话，教练每轮给提示 → 结束复盘。
// 场景来自检查页或示例页存下的报告；直接打开这一页时，从示例合同里选一份。
// 朗读用浏览器自带的 speechSynthesis，不额外调模型；浏览器不支持就不显示开关。

type Phase = "pick" | "talk" | "debrief";
type Session = { user: string | null; required: boolean };

class PracticeError extends Error {
  // 接口返回的错误代码，比如 login_required。项目开了 erasableSyntaxOnly，不用构造函数参数属性
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function post(body: object, signal?: AbortSignal) {
  const res = await fetch("/api/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new PracticeError(b?.message ?? `服务器返回 ${res.status}，请稍后再试。`, b?.error);
  }
  return res;
}

/** 示例合同：读录好的检查事件，用检查页同一个 reducer 还原出批注 */
async function sampleScenario(id: string): Promise<Scenario> {
  const r = await fetch(`/recordings/${id}.json`);
  if (!r.ok) throw new Error("recording");
  const rec = (await r.json()) as { events: ReviewEvent[] };
  const state = rec.events.reduce(reduceReview, initialReview);
  return scenarioFromFindings(state.docKind, visibleFindings(state));
}

const clauseLabel = (f: PracticeFinding) =>
  f.clause ? (f.clause.startsWith("第") ? f.clause : `第 ${f.clause} 条`) : "全文";

function speak(text: string) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  const voices = synth.getVoices();
  const v =
    voices.find((x) => x.lang.replace("_", "-") === "zh-CN") ??
    voices.find((x) => x.lang.startsWith("zh"));
  if (v) u.voice = v;
  synth.speak(u);
}

const TONE: Record<NonNullable<Coach["tone"]>, { text: string; cls: string }> = {
  steady: { text: "上一句语气平稳，有理有据", cls: "text-ok" },
  too_soft: { text: "上一句偏软，可以更明确地说出你的要求", cls: "text-orange" },
  too_hard: { text: "上一句有点冲，容易谈僵", cls: "text-red-pen" },
};

// sessionStorage 只在浏览器里有；服务端渲染时返回 undefined，表示"还没读"
const noSubscribe = () => () => {};

export function PracticeRoom() {
  const raw = useSyncExternalStore(noSubscribe, readScenarioRaw, () => undefined);
  const stored = useMemo(() => (raw === undefined ? undefined : parseScenario(raw)), [raw]);
  const [picked, setPicked] = useState<Scenario | null>(null);
  const scenario = picked ?? stored ?? null;

  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [chosen, setChosen] = useState<string[]>([]);
  const [style, setStyle] = useState<PracticeStyle>("formal");
  const [history, setHistory] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"hr" | "coach" | "debrief" | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<PracticeError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [speakOn, setSpeakOn] = useState(false);
  const canSpeak = useSyncExternalStore(
    noSubscribe,
    () => "speechSynthesis" in window,
    () => false,
  );
  const ctl = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json() as Promise<Session>)
      .then(setSession)
      .catch(() => setSession({ user: null, required: true }));
    return () => ctl.current?.abort();
  }, []);

  // 新内容出来时滚到对话底部
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [history]);

  // 默认先勾第一条（最重的那条，报告里已按严重程度排好）
  const findings = useMemo(() => scenario?.findings ?? [], [scenario]);
  const selected = findings.filter((f) => chosen.includes(f.id));
  const pick = chosen.length ? chosen : findings.slice(0, 1).map((f) => f.id);
  const rounds = history.filter((t) => t.role === "me").length;
  const opener = STYLES.find((s) => s.id === style)!.opener;
  const needLogin = (session?.required && !session.user) || error?.code === "login_required";

  const base = () => ({
    docKind: scenario!.docKind,
    style,
    findings: findings.filter((f) => pick.includes(f.id)),
  });

  async function chooseSample(id: string) {
    setLoadingSample(id);
    setError(null);
    try {
      const s = await sampleScenario(id);
      setPicked(s);
      setChosen([]);
    } catch {
      setError(new PracticeError("示例合同没有加载出来，请刷新重试。"));
    } finally {
      setLoadingSample(null);
    }
  }

  function begin() {
    setChosen(pick);
    setHistory([]);
    setDebrief(null);
    setError(null);
    setNotice(null);
    const first = findings.find((f) => pick.includes(f.id));
    // 第一张提示卡直接用报告里写好的谈判要点，不调模型
    setCoach({
      hint: first?.talkingPoint ?? "先说清楚是哪一条，再说依据和你希望怎么改。",
      findingId: first?.id ?? null,
      tone: null,
    });
    setPhase("talk");
  }

  async function askCoach(h: Turn[]) {
    setBusy("coach");
    try {
      const res = await post({ mode: "coach", ...base(), history: h }, ctl.current?.signal);
      setCoach((await res.json()) as Coach);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setNotice("这一轮的教练提示没有生成出来，可以照上一张提示接着谈。");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const text = draft.trim();
    const blocked = screenInput(text);
    if (blocked) return setNotice(blocked);
    const next: Turn[] = [...history, { role: "me", text }];
    setHistory([...next, { role: "hr", text: "" }]);
    setDraft("");
    setBusy("hr");
    setError(null);
    setNotice(null);
    ctl.current = new AbortController();
    let acc = "";
    try {
      const res = await post({ mode: "hr", ...base(), history: next }, ctl.current.signal);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setHistory([...next, { role: "hr", text: acc.replaceAll(CUT_MARK, "") }]);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setHistory(history);
      setDraft(text);
      setBusy(null);
      return setError(e instanceof PracticeError ? e : new PracticeError("网络断了，请再发一次。"));
    }
    const reply = acc.replaceAll(CUT_MARK, "").trim();
    if (!reply) {
      // 一个字都没回：撤回这一句，放回输入框，方便直接再发
      setHistory(history);
      setDraft(text);
      setBusy(null);
      return setError(new PracticeError("HR 这次没有回应，请再发一次。"));
    }
    const full: Turn[] = [...next, { role: "hr", text: reply }];
    setHistory(full);
    if (acc.includes(CUT_MARK))
      setNotice("HR 这句没说完，网络中断了。可以接着说，也可以再发一次。");
    if (speakOn && canSpeak) speak(reply);
    await askCoach(full);
  }

  async function finish() {
    setPhase("debrief");
    setBusy("debrief");
    setError(null);
    if (canSpeak) window.speechSynthesis.cancel();
    try {
      const res = await post({ mode: "debrief", ...base(), history }, ctl.current?.signal);
      setDebrief((await res.json()) as Debrief);
    } catch (e) {
      setError(
        e instanceof PracticeError ? e : new PracticeError("复盘没有生成出来，请再试一次。"),
      );
    } finally {
      setBusy(null);
    }
  }

  const loginNotice = needLogin && (
    <div className="rounded-md border border-line bg-card p-4 text-sm leading-6">
      <p>练习要调用模型，要先登录。</p>
      <p className="mt-2">
        <Link href="/login?next=/practice" className="font-medium underline">
          登录
        </Link>
      </p>
    </div>
  );

  const errorBox = error && !needLogin && (
    <p role="alert" className="rounded-sm bg-red-pen-bg px-3 py-2 text-sm text-red-pen">
      {error.message}
    </p>
  );

  const samplePicker = (
    <div className="flex flex-wrap gap-2">
      {SAMPLES.map((s) => (
        <Button
          key={s.id}
          variant="outline"
          size="sm"
          disabled={loadingSample !== null}
          onClick={() => void chooseSample(s.id)}
        >
          {loadingSample === s.id ? "正在加载" : s.title}
        </Button>
      ))}
    </div>
  );

  if (stored === undefined) return <p className="text-sm text-ink-2">正在加载</p>;

  if (!scenario || findings.length === 0)
    return (
      <div className="space-y-4">
        {errorBox}
        <p className="text-sm leading-6 text-ink-2">
          {scenario
            ? "这份报告里没有需要谈的条款。可以换一份示例合同练习："
            : "先在检查页检查一份合同，报告出来后点“练习怎么跟 HR 谈”。也可以直接用示例合同练习："}
        </p>
        {samplePicker}
      </div>
    );

  if (phase === "pick")
    return (
      <div className="space-y-8">
        {loginNotice}
        {errorBox}
        <section>
          <h2 className="text-lg font-semibold">
            1. 选要谈的条款（{scenario.docKind}，最多 {MAX_PICK} 条）
          </h2>
          <ul className="mt-3 space-y-2">
            {findings.map((f) => {
              const on = pick.includes(f.id);
              const full = !on && pick.length >= MAX_PICK;
              const v = VERDICT_STYLE[f.verdict];
              return (
                <li key={f.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-md border bg-card p-3 text-sm leading-6",
                      on ? "border-ink" : "border-line",
                      full && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`${clauseLabel(f)}：${f.title}`}
                      className="mt-1.5"
                      checked={on}
                      disabled={full}
                      onChange={() =>
                        setChosen(on ? pick.filter((x) => x !== f.id) : [...pick, f.id])
                      }
                    />
                    <span className="min-w-0">
                      <span className={cn("mr-2 rounded-sm px-1.5 py-0.5 text-xs", v.bg, v.text)}>
                        {v.label}
                      </span>
                      <span className="text-xs text-ink-2">{clauseLabel(f)}</span>
                      <span className="mt-1 block">{f.conclusion}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. 选 HR 的风格</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {STYLES.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "cursor-pointer rounded-md border bg-card p-3 text-sm leading-6",
                  style === s.id ? "border-ink" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="style"
                  aria-label={`${s.label}：${s.desc}`}
                  className="mr-2"
                  checked={style === s.id}
                  onChange={() => setStyle(s.id)}
                />
                <span className="font-medium">{s.label}</span>
                <span className="mt-1 block text-ink-2">{s.desc}</span>
              </label>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={begin} disabled={pick.length === 0 || needLogin}>
            开始练习
          </Button>
          <span className="text-sm text-ink-2">
            最多 {MAX_ROUNDS} 轮，你说一句、HR 回一句算一轮。
          </span>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">换一份示例合同</summary>
          <div className="mt-3">{samplePicker}</div>
        </details>
      </div>
    );

  if (phase === "debrief")
    return (
      <div className="space-y-6">
        {errorBox}
        <h2 className="text-lg font-semibold">复盘</h2>
        {busy === "debrief" && (
          <p role="status" className="text-sm text-ink-2">
            正在复盘这次对话
          </p>
        )}
        {debrief && (
          <>
            <ul className="space-y-3">
              {debrief.items.map((it) => (
                <li
                  key={it.key}
                  className="rounded-md border border-line bg-card p-4 text-sm leading-6"
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{DEBRIEF_LABELS[it.key]}</span>
                    <span className="tabular-nums" aria-label={`${it.score} 分，满分 5 分`}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <span
                          key={i}
                          aria-hidden
                          className={cn(
                            "ml-0.5 inline-block h-2 w-5 rounded-sm",
                            i < it.score ? "bg-ink" : "bg-paper-2",
                          )}
                        />
                      ))}
                      <span className="ml-2">{it.score} / 5</span>
                    </span>
                  </p>
                  <p className="mt-2">{it.comment}</p>
                  {it.quote && <p className="mt-2 text-ink-2">你说过：“{it.quote}”</p>}
                </li>
              ))}
            </ul>
            <p className="text-sm leading-6">{debrief.summary}</p>
          </>
        )}
        <div className="flex flex-wrap gap-3">
          {error && (
            <Button onClick={() => void finish()} disabled={busy !== null}>
              重新复盘
            </Button>
          )}
          <Button variant="outline" onClick={() => setPhase("pick")} disabled={busy !== null}>
            换条款或风格再练一次
          </Button>
          <Button variant="outline" onClick={begin} disabled={busy !== null}>
            同样设置再练一次
          </Button>
        </div>
      </div>
    );

  const coachFinding = selected.find((f) => f.id === coach?.findingId);

  return (
    <div className="space-y-4">
      {loginNotice}
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
        <span>
          {scenario.docKind} · HR 风格：{STYLES.find((s) => s.id === style)!.label} · 第 {rounds}/
          {MAX_ROUNDS} 轮
        </span>
        {canSpeak && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={speakOn}
              onChange={(e) => {
                setSpeakOn(e.target.checked);
                if (!e.target.checked) window.speechSynthesis.cancel();
              }}
            />
            朗读 HR 的回复
          </label>
        )}
      </div>

      {/* DOM 顺序按手机排：对话、教练提示、输入框、要谈的条款，手机上提示就在输入框正上方。
          宽屏按行列放成左右两栏：左边对话和输入，右边提示和条款 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-6">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ol
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label="和 HR 的对话"
            className="max-h-[28rem] space-y-3 overflow-y-auto rounded-md border border-line bg-card p-3 text-sm leading-6"
          >
            {[{ role: "hr" as const, text: opener }, ...history].map((t, i) => (
              <li key={i} className={cn("flex", t.role === "me" && "justify-end")}>
                <p
                  className={cn(
                    "max-w-[85%] rounded-md px-3 py-2",
                    t.role === "me" ? "bg-ink text-paper" : "bg-paper-2",
                  )}
                >
                  <span className="sr-only">{t.role === "me" ? "我：" : "HR："}</span>
                  {t.text || <span className="text-ink-2">HR 正在回复</span>}
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div className="lg:col-start-2 lg:row-start-1 lg:self-start">
          <section
            aria-label="教练提示"
            className="rounded-md border border-line border-l-4 border-l-ink bg-card p-4 text-sm leading-6"
          >
            <h2 className="font-medium">教练提示</h2>
            {busy === "coach" ? (
              <p role="status" className="mt-2 text-ink-2">
                教练在看你们刚才的对话
              </p>
            ) : (
              coach && (
                <>
                  {coach.tone && (
                    <p className={cn("mt-2", TONE[coach.tone].cls)}>{TONE[coach.tone].text}</p>
                  )}
                  <p className="mt-2">{coach.hint}</p>
                  {coachFinding && (
                    <p className="mt-2 text-xs text-ink-2">
                      针对：{clauseLabel(coachFinding)}　依据：
                      {coachFinding.basis.map((b) => b.label).join("、") || "见报告"}
                    </p>
                  )}
                </>
              )
            )}
          </section>
        </div>
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-2">
          {errorBox}
          {notice && (
            <p role="status" className="rounded-sm bg-orange-bg px-3 py-2 text-sm text-orange">
              {notice}
            </p>
          )}

          <label htmlFor="say" className="sr-only">
            你要对 HR 说的话
          </label>
          <textarea
            id="say"
            rows={3}
            maxLength={600}
            value={draft}
            disabled={rounds >= MAX_ROUNDS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim() && !busy) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              rounds >= MAX_ROUNDS
                ? `已经谈了 ${MAX_ROUNDS} 轮，点“结束并复盘”看看这次谈得怎样`
                : "先说是哪一条，再说依据和你希望怎么改"
            }
            className="w-full rounded-md border border-line bg-card p-3 text-sm leading-6"
          />
          <HoldToTalk
            disabled={busy !== null || rounds >= MAX_ROUNDS}
            onText={(t) => setDraft((d) => (d.trim() ? `${d.trimEnd()}${t}` : t))}
            onError={setNotice}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => void send()}
              disabled={!draft.trim() || busy !== null || rounds >= MAX_ROUNDS}
            >
              {busy === "hr" ? "HR 正在回复" : "发送"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void finish()}
              disabled={rounds === 0 || busy !== null}
            >
              结束并复盘
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                ctl.current?.abort();
                setPhase("pick");
              }}
            >
              重新选条款
            </Button>
          </div>
        </div>
        <div className="lg:col-start-2 lg:row-start-2 lg:self-start">
          <details open className="rounded-md border border-line bg-card p-4 text-sm leading-6">
            <summary className="cursor-pointer font-medium">要谈的条款</summary>
            <ul className="mt-2 space-y-3">
              {selected.map((f) => (
                <li key={f.id}>
                  <p className="text-xs text-ink-2">
                    {clauseLabel(f)} · {VERDICT_STYLE[f.verdict].label}
                  </p>
                  <p>{f.conclusion}</p>
                  {f.revision && <p className="mt-1 text-ink-2">建议改成：{f.revision.after}</p>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
