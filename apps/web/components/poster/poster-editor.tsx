"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, ensureSession, errorText } from "@/lib/client/api";

interface Candidate {
  attemptId: string;
  placeId: string;
  placeNameZh: string;
  grade: string | null;
  thumbUrl: string;
}

export function PosterEditor() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params.get("mode") === "demo" ? "demo" : "live";
  const run = params.get("run");
  const attempt = params.get("attempt");
  const place = params.get("place");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [cover, setCover] = useState<string | null>(attempt);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = mode === "demo" ? "&mode=demo" : "";

  useEffect(() => {
    const filter = run ? `run=${run}` : place ? `place=${place}` : "";
    ensureSession()
      .then(() => apiGet<{ items: Candidate[] }>(`/posters/cover-candidates?${filter}${q}`))
      .then((r) => setCandidates(r.items))
      .catch((e) => setError(errorText(e)));
  }, [run, place, q]);

  const placeId = useMemo(() => {
    if (place) return place;
    const c = candidates?.find((x) => x.attemptId === attempt);
    return c?.placeId ?? null;
  }, [place, attempt, candidates]);

  const kind = run ? "quest" : "place";
  const chars = [...caption].length;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === "quest"
          ? { kind, questRunId: run, coverAttemptId: cover, caption: caption.trim() || null }
          : { kind, placeId: placeId ?? undefined, coverAttemptId: cover, caption: caption.trim() || null };
      const r = await apiPost<{ posterId: string }>(`/posters${mode === "demo" ? "?mode=demo" : ""}`, body);
      router.push(`/posters/${r.posterId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const visible = kind === "place" && placeId ? (candidates ?? []).filter((c) => c.placeId === placeId) : (candidates ?? []);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <p className="eyebrow">{mode === "demo" ? "试玩纪念票根" : "纪念票根"}</p>
        <h1 className="serif text-2xl font-bold">选择封面与短句</h1>
        <p className="text-sm text-ink-2">票根只保存在你的记录里。下载不会公开；只有你主动创建分享链接后才会公开。</p>
      </header>

      <section className="space-y-2" aria-labelledby="cover">
        <h2 id="cover" className="font-bold">
          封面
        </h2>
        {candidates === null && !error && <p className="text-sm text-muted">加载作品…</p>}
        <ul className="grid grid-cols-3 gap-2">
          <li>
            <button
              type="button"
              aria-pressed={cover === null}
              onClick={() => setCover(null)}
              className={`grid aspect-square w-full place-items-center rounded-lg border-2 bg-paper-2 text-sm ${cover === null ? "border-vermilion" : "border-transparent"}`}
            >
              品牌底图
            </button>
          </li>
          {visible.map((c) => (
            <li key={c.attemptId}>
              <button
                type="button"
                aria-pressed={cover === c.attemptId}
                onClick={() => setCover(c.attemptId)}
                className={`relative block w-full overflow-hidden rounded-lg border-2 ${cover === c.attemptId ? "border-vermilion" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private photo */}
                <img src={c.thumbUrl} alt={`${c.placeNameZh} 的照片`} className="aspect-square w-full object-cover" />
                {c.grade && <span className="absolute bottom-1 right-1 rounded bg-white/90 px-1.5 text-xs font-bold text-vermilion">{c.grade}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">只能选择通过地点核验的照片。评级只会在已有真实评分时显示。</p>
      </section>

      <section className="space-y-2">
        <label htmlFor="caption" className="font-bold">
          短句（可选，最多 40 字）
        </label>
        <input
          id="caption"
          value={caption}
          onChange={(e) => setCaption([...e.target.value].slice(0, 40).join(""))}
          className="w-full rounded-lg border border-rule bg-white px-3 py-3"
          placeholder="例如：傍晚的台阶，猫店长的明信片。"
        />
        <p className="text-right text-xs text-muted">{chars}/40</p>
      </section>

      {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={busy || (kind === "place" && !placeId && !cover)} onClick={() => void create()}>
        {busy ? "正在提交…" : "生成票根"}
      </button>
    </div>
  );
}
