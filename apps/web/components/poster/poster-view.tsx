"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, errorText } from "@/lib/client/api";

interface PosterView {
  posterId: string;
  mode: "live" | "demo";
  status: "queued" | "rendering" | "ready" | "failed";
  snapshot: { title: string; subtitle: string; dateTokyo: string; caption: string | null; grade: string | null; stamps: string[]; hasCover: boolean };
  imageUrl: string | null;
  qrIncluded: boolean;
  share: { shareId: string; url: string; expiresAt: string } | null;
}

export function PosterViewClient({ posterId }: { posterId: string }) {
  const [poster, setPoster] = useState<PosterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await apiGet<PosterView>(`/posters/${posterId}`);
      setPoster(p);
      const qrPending = p.share !== null && !p.qrIncluded;
      if (p.status === "queued" || p.status === "rendering" || qrPending) timer.current = setTimeout(() => void load(), 1500);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "NOT_FOUND" ? "没有找到这张票根，可能已删除。" : errorText(e));
    }
  }, [posterId]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function share() {
    setBusy(true);
    try {
      await apiPost(`/posters/${posterId}/share`);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!poster?.share) return;
    setBusy(true);
    try {
      await apiDelete(`/shares/${poster.share.shareId}`);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      await apiPost(`/posters/${posterId}/retry`);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !poster) return <p className="notice notice-danger">{error}</p>;
  if (!poster) return <p role="status" className="text-muted">加载票根…</p>;
  const pending = poster.status === "queued" || poster.status === "rendering";

  return (
    <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-[1fr_1fr]">
      <div>
        {poster.imageUrl && !pending ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated PNG from our API
          <img src={poster.imageUrl} alt={`纪念票根：${poster.snapshot.title}`} width={1080} height={1440} className="h-auto w-full rounded-xl border border-rule shadow-sm" />
        ) : (
          <div role="status" className="grid aspect-[3/4] w-full place-items-center rounded-xl border border-dashed border-rule bg-paper-2 text-sm text-ink-2">
            {poster.status === "failed" ? "票根生成失败" : "正在生成票根…"}
          </div>
        )}
      </div>
      <div className="space-y-5">
        <header className="space-y-1">
          <p className="eyebrow">{poster.mode === "demo" ? "试玩纪念票根" : "纪念票根"}</p>
          <h1 className="serif text-2xl font-bold">{poster.snapshot.title}</h1>
          <p className="text-sm text-ink-2">
            {poster.snapshot.subtitle} · {poster.snapshot.dateTokyo}
          </p>
        </header>

        {poster.status === "failed" && (
          <div className="notice notice-danger space-y-2 text-sm">
            <p>票根生成失败，可以重试。</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void retry()}>
              重新生成
            </button>
          </div>
        )}

        {poster.status === "ready" && poster.imageUrl && (
          <a href={`${poster.imageUrl}&download=1`} className="btn btn-primary btn-block" download>
            下载 PNG（1080×1440）
          </a>
        )}

        {poster.mode === "live" && poster.status !== "failed" && (
          <section className="card space-y-3 p-4" aria-labelledby="share">
            <h2 id="share" className="font-bold">
              分享
            </h2>
            {poster.share ? (
              <>
                <p className="text-sm text-ink-2">
                  公开链接已创建，{new Date(poster.share.expiresAt).toLocaleDateString("zh-CN")} 前有效。
                  {poster.qrIncluded ? "下载的票根已包含二维码。" : "票根正在更新二维码…"}
                </p>
                <div className="flex gap-2">
                  <input readOnly value={poster.share.url} className="min-w-0 flex-1 rounded-lg border border-rule bg-paper-2 px-3 text-sm" aria-label="分享链接" />
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => navigator.clipboard.writeText(poster.share!.url).then(() => setCopied(true))}
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => void revoke()}>
                  撤销分享
                </button>
                <p className="text-xs text-muted">撤销后，公开页面和图片会立即无法访问。已被他人保存的副本无法收回。</p>
              </>
            ) : confirming ? (
              <div className="space-y-3">
                <p className="text-sm">创建后，任何拿到链接的人都能看到：</p>
                <ul className="list-disc pl-5 text-sm text-ink-2">
                  <li>这张票根图片（封面照片、{poster.snapshot.title}、{poster.snapshot.grade ? `评级 ${poster.snapshot.grade}、` : ""}印章、日期{poster.snapshot.caption ? "、短句" : ""}、二维码）</li>
                </ul>
                <p className="text-xs text-muted">不会公开：你的其他照片、足迹、定位、故事进度或访客身份。链接 30 天后失效，可随时撤销。</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void share()}>
                    确认创建分享链接
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-2">票根默认只有你能看到。需要分享时再创建公开链接。</p>
                <button type="button" className="btn btn-secondary btn-block" disabled={poster.status !== "ready"} onClick={() => setConfirming(true)}>
                  创建分享链接
                </button>
              </>
            )}
          </section>
        )}
        {poster.mode === "demo" && <p className="notice notice-info text-sm">试玩票根带“试玩纪念”标识，不能创建公开分享链接。</p>}
        {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
        <Link href={poster.mode === "demo" ? "/me?mode=demo&tab=posters" : "/me?tab=posters"} className="text-sm underline">
          查看我的全部票根
        </Link>
      </div>
    </div>
  );
}
