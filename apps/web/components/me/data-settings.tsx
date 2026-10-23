"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, errorText } from "@/lib/client/api";
import { tokyoDateTime } from "@/lib/client/format";

interface Upload {
  assetId: string;
  createdAt: string;
  state: "ready" | "deleting";
  thumbUrl: string | null;
}
interface Share {
  shareId: string;
  posterId: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function DataSettings() {
  const [hasVisitor, setHasVisitor] = useState<boolean | null>(null);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState("");
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await apiGet<{ hasVisitor: boolean }>("/me");
      setHasVisitor(me.hasVisitor);
      if (!me.hasVisitor) return;
      const [u, s] = await Promise.all([apiGet<{ items: Upload[] }>("/me/uploads"), apiGet<{ items: Share[] }>("/shares")]);
      setUploads(u.items);
      setShares(s.items);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "UNAUTHENTICATED")) setMsg(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  if (deleted) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="serif text-2xl font-bold">已开始删除</h1>
        <p className="text-ink-2">这台设备已不再使用原来的访客身份。服务器上的照片、票根和记录会在后台删除，通常几分钟内完成，最长不超过 24 小时。</p>
        <p className="text-sm text-muted">备份中的数据按部署的备份保留周期清除；已被他人下载保存的副本无法收回。</p>
        <Link href="/" className="btn btn-primary">
          回到首页
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">数据设置</p>
        <h1 className="serif text-3xl font-bold">你的数据，你来决定</h1>
        <p className="text-sm text-ink-2">
          记录保存在本设备的访客身份下（HttpOnly Cookie）。照片默认只有你能看到；只有你主动创建的分享链接会公开对应票根。原始定位坐标最长保留 24 小时，之后只保留距离和判定结果。
        </p>
      </header>
      {msg && <p role="status" className="notice notice-info text-sm">{msg}</p>}
      {hasVisitor === false && <p className="notice">这台设备上还没有记录。</p>}

      {hasVisitor && (
        <>
          <section className="space-y-3" aria-labelledby="shares">
            <h2 id="shares" className="serif text-xl font-bold">
              分享链接
            </h2>
            {shares?.length === 0 && <p className="text-sm text-muted">没有创建过分享链接。</p>}
            <ul className="space-y-2">
              {shares?.map((s) => {
                const active = !s.revokedAt && new Date(s.expiresAt) > new Date();
                return (
                  <li key={s.shareId} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span>
                      <Link href={`/posters/${s.posterId}`} className="font-semibold underline">
                        {s.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        创建于 {tokyoDateTime(s.createdAt)} · {active ? `有效至 ${tokyoDateTime(s.expiresAt)}` : s.revokedAt ? "已撤销" : "已过期"}
                      </span>
                    </span>
                    {active && (
                      <button type="button" className="btn btn-secondary" onClick={() => void run(() => apiDelete(`/shares/${s.shareId}`), "分享已撤销，原链接已无法访问。")}>
                        撤销
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="space-y-3" aria-labelledby="photos">
            <h2 id="photos" className="serif text-xl font-bold">
              我上传的照片
            </h2>
            <p className="text-xs text-muted">删除照片会移除对应作品、评分与评语，撤销使用它的分享，并重新生成相关票根；已获得的印章和任务完成记录会保留。</p>
            {uploads?.length === 0 && <p className="text-sm text-muted">没有上传过照片。</p>}
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {uploads?.map((u) => (
                <li key={u.assetId} className="space-y-1 text-xs">
                  {u.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private photo
                    <img src={u.thumbUrl} alt="上传的照片" className="aspect-square w-full rounded object-cover" />
                  ) : (
                    <div className="grid aspect-square place-items-center rounded bg-paper-2">删除中</div>
                  )}
                  <span className="block text-muted">{tokyoDateTime(u.createdAt)}</span>
                  {u.state === "ready" && (
                    <button type="button" className="underline" onClick={() => void run(() => apiDelete(`/photos/${u.assetId}`), "照片已开始删除。")}>
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="notice notice-danger space-y-3" aria-labelledby="all">
            <h2 id="all" className="font-bold">
              清空这个访客的全部数据
            </h2>
            <p className="text-sm">将删除全部照片、票根、分享、足迹、印章和故事进度（真实与试玩记录都会删除），且无法恢复。</p>
            <label className="block text-sm">
              输入“删除全部”以确认
              <input value={confirmAll} onChange={(e) => setConfirmAll(e.target.value)} className="mt-1 w-full rounded border border-rule bg-white px-2 py-2" />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirmAll !== "删除全部"}
              onClick={() =>
                void apiDelete("/me/data")
                  .then(() => setDeleted(true))
                  .catch((e) => setMsg(errorText(e)))
              }
            >
              清空全部数据
            </button>
          </section>
        </>
      )}
    </div>
  );
}
