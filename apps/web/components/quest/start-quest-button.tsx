"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost, errorText } from "@/lib/client/api";

export function StartQuestButton({ questId, mode = "live" }: { questId: string; mode?: "live" | "demo" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ runId: string }>(mode === "demo" ? "/demo/quest-runs" : "/quest-runs", { questId });
      router.push(mode === "demo" ? `/demo/adventure/${r.runId}` : `/adventures/${r.runId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void start()}>
        {busy ? "正在领取…" : mode === "demo" ? "开始试玩这段故事" : "领取任务票"}
      </button>
      {mode === "live" && <p className="text-center text-xs text-muted">进度保存在本设备的访客身份下，不需要注册。</p>}
      {error && (
        <p role="alert" className="notice notice-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
