"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost, errorText } from "@/lib/client/api";

// Demo photo check-in uses only the fixed, labelled samples (spec §3.4).

interface Sample {
  key: string;
  label: string;
  imageUrl: string;
}

export function DemoSamplePicker(props: { placeId: string; quest?: { runId: string; stepId: string } | null }) {
  const router = useRouter();
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: Sample[] }>(`/demo/samples?placeId=${props.placeId}`)
      .then((r) => setSamples(r.items))
      .catch((e) => setError(errorText(e)));
  }, [props.placeId]);

  async function pick(key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await apiPost<{ attemptId: string }>("/demo/photo-attempts", {
        placeId: props.placeId,
        sampleKey: key,
        questRunId: props.quest?.runId ?? null,
        questStepId: props.quest?.stepId ?? null,
      });
      router.push(`/attempts/${r.attemptId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  if (error) return <p className="notice notice-danger text-sm">{error}</p>;
  if (!samples) return <p className="text-sm text-muted">加载样例照片…</p>;
  if (samples.length === 0) return <p className="text-sm text-muted">这个地点没有试玩样例照片。</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">选一张样例照片（试玩）</p>
      <ul className="grid grid-cols-3 gap-2">
        {samples.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              className="w-full space-y-1 rounded-lg border border-rule p-1 text-left text-xs hover:border-ink disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void pick(s.key)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- sample served from our API */}
              <img src={s.imageUrl} alt={s.label} className="aspect-square w-full rounded object-cover" />
              <span className="block px-0.5">{busy === s.key ? "提交中…" : s.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">样例结果是固定的，用来展示核验和评分流程，不代表 AI 对任意照片的判断。样例图片来自 Wikimedia Commons（含署名许可）。</p>
    </div>
  );
}
