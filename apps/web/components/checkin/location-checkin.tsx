"use client";

import { useState } from "react";
import { ApiError, apiPost } from "@/lib/client/api";
import { formatDistance } from "@/lib/client/format";
import type { CheckinEffects } from "@/lib/client/types";
import { geoMessage, useGeolocation } from "@/lib/client/use-geolocation";
import { StampBurst } from "./stamp-burst";

// Location check-in (spec §5.1). Sends the raw reading; the server computes the
// distance and decides. Simulated positions exist only in demo mode.

interface Result {
  checkin: { distanceMeters: number; accuracyMeters: number; simulated: boolean };
  label: string;
  effects: CheckinEffects;
}

export function LocationCheckin(props: {
  placeId: string;
  placeName: string;
  mode?: "live" | "demo";
  quest?: { runId: string; stepId: string } | null;
  demoPosition?: { latitude: number; longitude: number } | null;
  onDone?: (r: Result) => void;
}) {
  const geo = useGeolocation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<{ message: string; details: Record<string, unknown> | null } | null>(null);
  const demo = props.mode === "demo";

  async function run() {
    setFailure(null);
    setResult(null);
    const reading = demo
      ? { ...props.demoPosition!, accuracyMeters: 10, capturedAt: new Date().toISOString() }
      : await geo.locate();
    if (!reading) return;
    setBusy(true);
    try {
      const r = await apiPost<Result>(demo ? "/demo/checkins/location" : "/checkins/location", {
        placeId: props.placeId,
        position: reading,
        questRunId: props.quest?.runId ?? null,
        questStepId: props.quest?.stepId ?? null,
      });
      setResult(r);
      props.onDone?.(r);
    } catch (e) {
      setFailure(e instanceof ApiError ? { message: e.message, details: e.details } : { message: "定位打卡失败，请重试", details: null });
    } finally {
      setBusy(false);
    }
  }

  const geoMsg = geoMessage(geo.state);
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => void run()}
        disabled={busy || geo.state.status === "locating"}
      >
        {geo.state.status === "locating" ? "正在定位…" : busy ? "正在核对位置…" : demo ? "模拟到达并打卡（试玩）" : "定位打卡"}
      </button>
      {geo.state.status === "locating" && (
        <button type="button" className="btn btn-quiet btn-block" onClick={geo.cancel}>
          取消定位
        </button>
      )}
      {geoMsg && <p className="notice notice-warn text-sm">{geoMsg}</p>}
      {failure && (
        <div role="alert" className="notice notice-danger space-y-1 text-sm">
          <p className="font-semibold">{failure.message}</p>
          {typeof failure.details?.distanceMeters === "number" && (
            <p>
              服务端计算的直线距离约 {formatDistance(failure.details.distanceMeters as number)}，打卡范围 {String(failure.details.radiusMeters)} m，
              设备报告精度 ±{String(failure.details.accuracyMeters)} m。
            </p>
          )}
          <button type="button" className="underline" onClick={() => void run()}>
            重新定位
          </button>
        </div>
      )}
      {result && (
        <div role="status" className="notice notice-ok space-y-2 text-sm">
          <p className="font-semibold">
            ✓ {result.label}
            {result.checkin.simulated && <span className="chip ml-2">试玩</span>}
          </p>
          <p className="text-ink-2">
            服务端计算的直线距离约 {formatDistance(result.checkin.distanceMeters)}（精度 ±{result.checkin.accuracyMeters} m）。这表示设备报告的位置在范围内，并不是不可伪造的到访认证。
          </p>
          {result.effects.questStepCompleted && <p className="font-semibold text-line-green">故事任务已完成，下一段故事已解锁。</p>}
          {result.effects.questNote && <p className="text-warn">{result.effects.questNote}</p>}
          <StampBurst stamps={result.effects.stampsAwarded} placeName={props.placeName} demo={demo} />
        </div>
      )}
    </div>
  );
}
