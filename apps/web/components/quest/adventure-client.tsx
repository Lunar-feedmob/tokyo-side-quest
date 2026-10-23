"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LocationCheckin } from "@/components/checkin/location-checkin";
import { DemoSamplePicker } from "@/components/checkin/demo-sample-picker";
import { StampBurst } from "@/components/checkin/stamp-burst";
import { ApiError, apiGet, apiPost, errorText } from "@/lib/client/api";
import { tokyoDate } from "@/lib/client/format";
import type { QuestRunView } from "@/lib/client/types";

// A quest run (spec §3.3, §5.3). Progress lives on the server; this page only
// shows it and submits evidence for the current step.

export function AdventureClient({ runId, mode }: { runId: string; mode: "live" | "demo" }) {
  const [run, setRun] = useState<QuestRunView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiGet<QuestRunView>(`/quest-runs/${runId}`)
      .then((r) => {
        if (cancelled) return;
        setRun(r);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, reloadKey]);

  async function setStatus(action: "end" | "resume") {
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/quest-runs/${runId}/${action}`);
      await load();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !run) {
    return (
      <div className="notice notice-danger space-y-2">
        <p>{error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" ? "没有找到这次故事探索。它可能保存在另一台设备上。" : error.message}</p>
        <Link href="/quests" className="underline">
          查看全部故事
        </Link>
      </div>
    );
  }
  if (!run) return <p role="status" className="text-muted">加载故事进度…</p>;

  const demo = mode === "demo";
  const done = run.steps.filter((s) => s.status === "completed" && s.required).length;
  const total = run.steps.filter((s) => s.required).length;
  const current = run.steps.find((s) => s.id === run.currentStepId) ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {demo && (
        <p className="notice notice-info text-sm">
          <strong>试玩模式</strong> · 使用模拟定位和样例照片，进度与印章只存在试玩空间，不计入真实记录。
        </p>
      )}
      <header className="ticket space-y-2 p-5">
        <p className="eyebrow">
          {demo ? "试玩 · " : ""}故事探索 · {done}/{total}
        </p>
        <h1 className="serif text-2xl font-bold">{run.quest.title}</h1>
        <div className="h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-label="故事进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="h-full bg-line-green" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <p className="text-xs text-muted">
          {run.status === "active" && "进行中"}
          {run.status === "ended_partial" && "已结束（未全部完成），可以随时恢复"}
          {run.status === "completed" && run.completedAt && `已完成 · ${tokyoDate(run.completedAt)}`}
          {" · "}
          {run.quest.fictionNote}
        </p>
      </header>

      {run.status === "completed" && run.quest.ending && (
        <section className="ticket space-y-3 p-6" aria-labelledby="ending">
          <p id="ending" className="eyebrow">
            结局
          </p>
          <p className="leading-relaxed">{run.quest.ending}</p>
          <StampBurst stamps={[`quest:${run.quest.slug}`]} placeName={run.quest.title} demo={demo} />
          {justCompleted && <p className="text-sm font-semibold text-line-green">恭喜完成全部主要任务！</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href={`/posters/new?run=${run.runId}${demo ? "&mode=demo" : ""}`} className="btn btn-primary">
              {demo ? "生成试玩纪念票根" : "生成故事纪念票根"}
            </Link>
            <Link href={demo ? "/demo" : "/me"} className="btn btn-quiet">
              {demo ? "回到试玩" : "查看我的东京"}
            </Link>
          </div>
        </section>
      )}

      {run.status === "ended_partial" && (
        <div className="notice notice-warn flex flex-wrap items-center justify-between gap-3">
          <span>这次探索已结束，尚未完成全部任务。</span>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void setStatus("resume")}>
            恢复探索
          </button>
        </div>
      )}

      <ol className="space-y-4">
        {run.steps.map((s) => (
          <li key={s.id} className={`card space-y-3 p-5 ${s.status === "current" ? "border-2 border-vermilion" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">
                  任务 {s.position} · {s.place.nameZh}
                </p>
                <h2 className="text-lg font-bold">{s.title}</h2>
              </div>
              {s.status === "completed" && <span className="chip chip-ok">✓ 已完成</span>}
              {s.status === "current" && <span className="chip chip-danger">当前任务</span>}
              {s.status === "locked" && <span className="chip">未解锁</span>}
            </div>
            {s.status !== "locked" && (
              <>
                {s.story && <p className="leading-relaxed">{s.story}</p>}
                {s.objective && (
                  <p className="text-sm">
                    <strong>目标：</strong>
                    {s.objective}
                  </p>
                )}
                {s.clue && (
                  <p className="text-sm text-ink-2">
                    <strong>线索：</strong>
                    {s.clue}
                  </p>
                )}
                {s.observationQuestion && (
                  <p className="notice notice-info text-sm">
                    <strong>观察：</strong>
                    {s.observationQuestion}
                  </p>
                )}
              </>
            )}
            {s.status === "completed" && (
              <>
                {s.completionText && <p className="text-sm text-line-green">{s.completionText}</p>}
                {s.proofLabel && <p className="text-xs text-muted">完成依据：{s.proofLabel}</p>}
              </>
            )}
            {s.status === "current" && run.status === "active" && current && (
              <StepActions run={run} step={current} demo={demo} onProgress={async (completed) => {
                if (completed) setJustCompleted(true);
                await load();
              }} />
            )}
          </li>
        ))}
      </ol>

      {actionError && <p role="alert" className="notice notice-danger text-sm">{actionError}</p>}
      {run.status === "active" && (
        <div className="text-center">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void setStatus("end")}>
            结束本次探索
          </button>
          <p className="mt-1 text-xs text-muted">结束后进度会保留，可以随时恢复。</p>
        </div>
      )}
    </div>
  );
}

function StepActions(props: {
  run: QuestRunView;
  step: QuestRunView["steps"][number];
  demo: boolean;
  onProgress: (questCompleted: boolean) => Promise<void>;
}) {
  const { step, run, demo } = props;
  const allowLocation = step.proofPolicy !== "photo";
  const allowPhoto = step.proofPolicy !== "location" && step.place.photoEnabled;
  if (!step.place.available) {
    return <p className="notice notice-warn text-sm">这个地点暂时关闭，任务暂停。已有进度会保留。</p>;
  }
  return (
    <div className="space-y-3 border-t border-rule pt-3">
      <p className="text-sm font-semibold">完成方式（任选其一）</p>
      <div className={`grid gap-3 ${allowLocation && allowPhoto ? "sm:grid-cols-2" : ""}`}>
        {allowLocation && (
          <LocationCheckin
            placeId={step.place.id}
            placeName={step.place.nameZh}
            mode={demo ? "demo" : "live"}
            demoPosition={demo ? { latitude: step.place.latitude, longitude: step.place.longitude } : null}
            quest={{ runId: run.runId, stepId: step.id }}
            onDone={(r) => void props.onProgress(r.effects.questCompleted)}
          />
        )}
        {allowPhoto &&
          (demo ? (
            <DemoSamplePicker placeId={step.place.id} quest={{ runId: run.runId, stepId: step.id }} />
          ) : (
            <Link
              href={`/checkin/${step.place.id}?run=${run.runId}&step=${step.id}&title=${encodeURIComponent(step.title)}`}
              className="btn btn-primary"
            >
              拍照打卡
            </Link>
          ))}
      </div>
      {!allowPhoto && step.proofPolicy !== "location" && (
        <p className="text-xs text-muted">这个地点暂不支持照片核验，请使用定位打卡。</p>
      )}
      <Link href={`/places/${step.place.slug}`} className="text-sm underline">
        查看地点资料与导航
      </Link>
    </div>
  );
}
