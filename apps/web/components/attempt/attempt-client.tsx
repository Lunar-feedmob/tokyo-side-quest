"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, errorText } from "@/lib/client/api";
import type { AttemptView } from "@/lib/client/types";

// Result page (spec §4.6, §9). Polls with backoff while work is pending, stops
// when the tab is hidden, and resumes from the attempt id after a refresh.

const DIMENSIONS: [keyof NonNullable<AttemptView["rating"]["dimensions"]>, string, string][] = [
  ["composition", "构图", "30%"],
  ["lighting", "光影", "25%"],
  ["clarity", "主体清晰度", "25%"],
  ["expression", "场景表达", "20%"],
];

function isPending(a: AttemptView) {
  return (
    a.processingStatus === "queued" ||
    (a.processingStatus === "running" && (a.verification.status === "pending" || a.rating.status === "pending"))
  );
}

export function AttemptClient({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [pollKey, setPollKey] = useState(0);

  // Backoff polling while work is pending; paused while the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1500;
    const started = Date.now();
    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const a = await apiGet<AttemptView>(`/photo-attempts/${attemptId}`);
        if (cancelled) return;
        setAttempt(a);
        setLoadError(null);
        setSlow(Date.now() - started > 60_000);
        if (!isPending(a)) return;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError) setLoadError(e);
        if (e instanceof ApiError && (e.code === "NOT_FOUND" || e.code === "UNAUTHENTICATED")) return;
      }
      delay = Math.min(delay * 1.5, 10_000);
      timer = setTimeout(() => void tick(), delay);
    };
    const onVisible = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        delay = 1500;
        void tick();
      }
    };
    timer = setTimeout(() => void tick(), 0);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attemptId, pollKey]);

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(path, body);
      setPollKey((k) => k + 1);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !attempt) {
    return (
      <div className="notice notice-danger space-y-2">
        <p>{loadError.code === "NOT_FOUND" || loadError.code === "UNAUTHENTICATED" ? "没有找到这次照片打卡。它可能属于另一台设备，或已被删除。" : loadError.message}</p>
        <Link href="/me" className="underline">
          返回我的东京
        </Link>
      </div>
    );
  }
  if (!attempt) return <p role="status" className="text-muted">正在读取结果…</p>;

  const a = attempt;
  const v = a.verification;
  const r = a.rating;
  const demo = a.mode === "demo";

  return (
    <div className="space-y-6">
      {demo && (
        <p className="notice notice-info text-sm">
          <strong>试玩模式</strong> · 这是固定的样例结果，不是 AI 对你照片的评价，也不会计入真实足迹和印章。
        </p>
      )}
      <header className="flex items-start gap-4">
        {a.photo.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- private photo via authenticated API
          <img src={a.photo.previewUrl} alt="提交的照片" className="h-24 w-24 shrink-0 rounded-lg border border-rule object-cover" />
        )}
        <div className="space-y-1">
          <p className="eyebrow">{a.photo.sampleLabel ? `${a.photo.sampleLabel} · 拍照打卡` : "拍照打卡"}</p>
          <h1 className="serif text-2xl font-bold leading-tight">{a.place.nameZh}</h1>
          <p className="text-sm text-ink-2" lang="ja">
            {a.place.nameJa}
          </p>
        </div>
      </header>

      <Steps a={a} />

      <div aria-live="polite" className="space-y-6">
        {isPending(a) && (
          <div role="status" className="notice notice-info space-y-1">
            <p className="font-semibold">{a.stageLabel}…</p>
            <p className="text-sm text-ink-2">
              {slow ? "这次耗时比平时长，结果仍在处理中。" : "通常需要一小会儿。"}你可以离开这个页面，之后在“我的东京”里找回这次结果。
            </p>
          </div>
        )}

        {/* ── Place verification ── */}
        {v.status === "matched" && (
          <section className="notice notice-ok space-y-2">
            <p className="font-semibold">✓ 地点匹配</p>
            {v.message && <p className="text-sm">{v.message}</p>}
            {a.checkin && (
              <p className="text-sm">
                <span className="chip chip-ok">{a.checkin.label}</span>
                {!a.checkin.arrivalVerified && !demo && (
                  <span className="mt-1 block text-xs text-ink-2">照片地点匹配只说明画面与地点相符，不代表你此刻身处现场。</span>
                )}
              </p>
            )}
            {a.verification.source === "human" && <p className="text-xs text-ink-2">此结果经人工复核确认。</p>}
          </section>
        )}
        {v.status === "uncertain" && (
          <section className="notice notice-warn space-y-2">
            <p className="font-semibold">无法确认是这个地点</p>
            {v.message && <p className="text-sm">{v.message}</p>}
            <Evidence a={a} />
            {v.reshootSuggestion && <p className="text-sm">建议：{v.reshootSuggestion}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={reshootHref(a)} className="btn btn-primary">
                重新拍摄
              </Link>
              {a.canRequestReview && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(`/photo-attempts/${a.attemptId}/review`)}>
                  申请人工复核
                </button>
              )}
            </div>
            {a.review && (
              <p className="text-sm">
                人工复核：{a.review.status === "open" ? "已提交，等待处理" : a.review.status === "approved" ? "已通过" : `未通过${a.review.reason ? `（${a.review.reason}）` : ""}`}
              </p>
            )}
          </section>
        )}
        {v.status === "mismatched" && (
          <section className="notice notice-danger space-y-2">
            <p className="font-semibold">照片与这个地点不一致</p>
            {v.message && <p className="text-sm">{v.message}</p>}
            <Evidence a={a} />
            {v.reshootSuggestion && <p className="text-sm">建议：{v.reshootSuggestion}</p>}
            <p className="text-xs text-ink-2">地点不匹配时不会进行摄影评分，也不会产生任何等级。</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/places/${a.place.slug}`} className="btn btn-secondary">
                返回目标地点
              </Link>
              <Link href={reshootHref(a)} className="btn btn-primary">
                重新拍摄
              </Link>
            </div>
          </section>
        )}
        {(v.status === "error" || (a.error && a.error.stage === "verify")) && (
          <section role="alert" className="notice notice-danger space-y-2">
            <p className="font-semibold">地点核验暂时失败（技术问题）</p>
            <p className="text-sm">
              {a.error?.code === "PLACE_UNAVAILABLE"
                ? "这个地点在处理期间暂停了打卡，这次不会发放奖励。"
                : "这不是“地点不匹配”。已上传的照片会保留，你可以重新尝试核验。"}
            </p>
            {a.canRetry === "verify" && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(`/photo-attempts/${a.attemptId}/retry`)}>
                重试核验
              </button>
            )}
          </section>
        )}

        {/* ── Photography rating (only after a match) ── */}
        {v.status === "matched" && r.status === "completed" && r.grade && r.dimensions && (
          <section className="ticket space-y-4 p-5" aria-labelledby="rating">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p id="rating" className="eyebrow">
                  摄影评级 · AI 建议
                </p>
                <p className="grade text-6xl text-vermilion" aria-label={`等级 ${r.grade}`}>
                  {r.grade}
                </p>
                <p className="text-sm text-ink-2">{r.gradeMeaning}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">总分</p>
                <p className="grade text-4xl">{r.total}</p>
              </div>
            </div>
            <div className="perforation" />
            <ul className="space-y-2">
              {DIMENSIONS.map(([key, label, weight]) => (
                <li key={key} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span>
                    {label} <span className="text-xs text-muted">{weight}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                    <span className="block h-full bg-line-green" style={{ width: `${r.dimensions![key]}%` }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{r.dimensions![key]}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 text-sm">
              <p>
                <strong>亮点：</strong>
                {r.strength}
              </p>
              <p>
                <strong>可以试试：</strong>
                {r.improvement}
              </p>
            </div>
            <p className="text-xs text-muted">按固定标准给出的 AI 建议，不是权威结论。评分规则 {r.rubricVersion}。</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/posters/new?attempt=${a.attemptId}&place=${a.place.id}${demo ? "&mode=demo" : ""}`} className="btn btn-primary">
                {demo ? "生成试玩纪念票根" : "生成纪念票根"}
              </Link>
              {!demo && (
                <Link href={`/checkin/${a.place.id}`} className="btn btn-quiet">
                  再拍一张
                </Link>
              )}
            </div>
          </section>
        )}
        {v.status === "matched" && r.status === "unscorable" && (
          <section className="notice space-y-1">
            <p className="font-semibold">地点已匹配，但这张照片暂时无法评价</p>
            {r.unscorableReason && <p className="text-sm">{r.unscorableReason}</p>}
            <p className="text-xs text-muted">打卡记录已保存。</p>
          </section>
        )}
        {v.status === "matched" && r.status === "error" && (
          <section role="alert" className="notice notice-warn space-y-2">
            <p className="font-semibold">打卡已成功，摄影评分暂不可用</p>
            <p className="text-sm">重试只会重新评分，不会重复打卡或重复推进故事。</p>
            {a.canRetry === "rate" && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(`/photo-attempts/${a.attemptId}/retry`)}>
                重试评分
              </button>
            )}
          </section>
        )}
      </div>

      {actionError && (
        <p role="alert" className="notice notice-danger text-sm">
          {actionError}
        </p>
      )}

      <nav className="flex flex-wrap gap-3 text-sm">
        {a.quest && (
          <Link href={demo ? `/demo/adventure/${a.quest.runId}` : `/adventures/${a.quest.runId}`} className="btn btn-secondary">
            回到故事
          </Link>
        )}
        <Link href={demo ? "/demo" : "/me"} className="btn btn-quiet">
          {demo ? "回到试玩" : "我的东京"}
        </Link>
      </nav>
    </div>
  );
}

function reshootHref(a: AttemptView): string {
  if (a.mode === "demo") return a.quest ? `/demo/adventure/${a.quest.runId}` : "/demo";
  return a.quest ? `/checkin/${a.place.id}?run=${a.quest.runId}&step=${a.quest.stepId}` : `/checkin/${a.place.id}`;
}

function Steps({ a }: { a: AttemptView }) {
  const verifyDone = !["pending"].includes(a.verification.status);
  const steps = [
    { label: "上传完成", state: "done" as const },
    {
      label: "核对地点",
      state: a.verification.status === "pending" ? ("active" as const) : a.verification.status === "error" ? ("failed" as const) : ("done" as const),
    },
    {
      label: "摄影评价",
      state:
        a.verification.status !== "matched"
          ? ("skipped" as const)
          : a.rating.status === "pending"
            ? ("active" as const)
            : a.rating.status === "error"
              ? ("failed" as const)
              : ("done" as const),
    },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="处理进度">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span
            className={`chip ${s.state === "done" ? "chip-ok" : s.state === "active" ? "chip-info" : s.state === "failed" ? "chip-danger" : ""}`}
          >
            {s.state === "done" ? "✓" : s.state === "active" ? "…" : s.state === "failed" ? "!" : "–"} {s.label}
            <span className="sr-only">
              {s.state === "done" ? "已完成" : s.state === "active" ? "进行中" : s.state === "failed" ? "失败" : "不适用"}
            </span>
          </span>
          {i < steps.length - 1 && <span aria-hidden className="text-muted">→</span>}
        </li>
      ))}
      {verifyDone && null}
    </ol>
  );
}

function Evidence({ a }: { a: AttemptView }) {
  if (a.verification.evidence.length === 0) return null;
  const label = { supports: "相符", contradicts: "冲突", not_visible: "看不到" } as const;
  return (
    <ul className="space-y-1 text-sm">
      {a.verification.evidence.map((e, i) => (
        <li key={i}>
          <span className={`chip ${e.relation === "supports" ? "chip-ok" : e.relation === "contradicts" ? "chip-danger" : ""}`}>{label[e.relation]}</span>{" "}
          <strong>{e.feature}</strong>：{e.observation}
        </li>
      ))}
    </ul>
  );
}
