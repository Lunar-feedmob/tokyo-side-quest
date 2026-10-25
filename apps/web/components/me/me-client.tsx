"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, errorText } from "@/lib/client/api";
import { formatDistance, tokyoDate, tokyoDateTime } from "@/lib/client/format";

interface Overview {
  hasVisitor: boolean;
  deletionRequested?: boolean;
  counts?: { footprints: number; photos: number; stamps: number; posters: number };
  runs?: { runId: string; status: string; title: string; done: number; total: number; startedAt: string; questSlug: string }[];
}
interface Checkin {
  id: string;
  placeSlug: string;
  placeNameZh: string;
  method: "location" | "photo";
  arrivalVerified: boolean;
  distanceMeters: number | null;
  attemptId: string | null;
  acceptedAt: string;
  label: string;
}
interface Photo {
  attemptId: string;
  placeSlug: string;
  placeNameZh: string;
  grade: string | null;
  total: number | null;
  ratingStatus: string;
  thumbUrl: string;
  isBest: boolean;
  createdAt: string;
  label: string;
}
interface Stamp {
  stampKey: string;
  kind: "place" | "quest";
  awardedAt: string;
}
interface Poster {
  id: string;
  status: string;
  title: string;
  createdAt: string;
  shared: boolean;
}

const TABS = [
  ["footprints", "到访足迹"],
  ["photos", "摄影作品"],
  ["stamps", "城市印章"],
  ["stories", "故事进度"],
  ["posters", "纪念票根"],
] as const;
type Tab = (typeof TABS)[number][0];

export function MeClient() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params.get("mode") === "demo" ? "demo" : "live";
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "footprints") as Tab;
  const q = mode === "demo" ? "?mode=demo" : "";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Overview>(`/me${q}`)
      .then(setOverview)
      .catch((e) => setError(errorText(e)));
  }, [q]);

  function go(next: Tab) {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", next);
    router.replace(`/me?${sp.toString()}`);
  }

  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!overview) return <p role="status" className="text-muted">加载中…</p>;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">{mode === "demo" ? "我的东京 · 试玩记录" : "我的东京"}</p>
        <h1 className="serif text-3xl font-bold">{mode === "demo" ? "试玩空间" : "你的东京收藏册"}</h1>
        <p className="text-sm text-muted">
          记录保存在本设备的访客身份下；清除浏览器数据后可能无法找回。
          {mode === "demo" ? (
            <Link href="/me" className="ml-1 underline">
              切换到真实记录
            </Link>
          ) : (
            <Link href="/me?mode=demo" className="ml-1 underline">
              查看试玩记录
            </Link>
          )}
        </p>
        {overview.deletionRequested && <p className="notice notice-warn text-sm">数据正在删除中。</p>}
      </header>

      {!overview.hasVisitor ? (
        <EmptyStart />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["足迹", overview.counts?.footprints ?? 0],
              ["作品", overview.counts?.photos ?? 0],
              ["印章", overview.counts?.stamps ?? 0],
              ["票根", overview.counts?.posters ?? 0],
            ].map(([k, n]) => (
              <div key={k} className="card p-3 text-center">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="grade text-3xl">{n}</dd>
              </div>
            ))}
          </dl>

          <div role="tablist" aria-label="收藏分类" className="flex gap-1 overflow-x-auto rounded-full bg-paper-2 p-1">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${tab === key ? "bg-white shadow-sm" : "text-ink-2"}`}
                onClick={() => go(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === "footprints" && <Footprints q={q} />}
            {tab === "photos" && <Photos q={q} />}
            {tab === "stamps" && <Stamps q={q} demo={mode === "demo"} />}
            {tab === "stories" && <Stories runs={overview.runs ?? []} demo={mode === "demo"} />}
            {tab === "posters" && <Posters q={q} />}
          </div>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/settings/data" className="underline">
          数据设置：删除照片、撤销分享、清空访客数据
        </Link>
      </p>
    </div>
  );
}

function EmptyStart() {
  return (
    <div className="notice space-y-3">
      <p className="font-semibold">还没有记录。</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/explore" className="btn btn-primary">
          发现附近地点
        </Link>
        <Link href="/quests" className="btn btn-secondary">
          领取一段故事
        </Link>
        <Link href="/demo" className="btn btn-quiet">
          在线试玩
        </Link>
      </div>
    </div>
  );
}

function useList<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ items: T[] }>(path)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  }, [path]);
  return { items, error };
}

function Footprints({ q }: { q: string }) {
  const { items, error } = useList<Checkin>(`/me/checkins${q}`);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!items) return <p className="text-muted">加载中…</p>;
  if (items.length === 0) return <EmptyStart />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">“到访足迹”只统计设备位置符合范围的记录；仅照片匹配的记录会单独标注，不计为到访。</p>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <Link href={`/places/${c.placeSlug}`} className="font-semibold">
                {c.placeNameZh}
              </Link>
              <p className="text-xs text-muted">
                {tokyoDateTime(c.acceptedAt)}
                {c.distanceMeters !== null && ` · 直线 ${formatDistance(c.distanceMeters)}`}
              </p>
            </div>
            <span className={`chip ${c.arrivalVerified ? "chip-ok" : ""}`}>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Photos({ q }: { q: string }) {
  const { items, error } = useList<Photo>(`/me/photos${q}`);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!items) return <p className="text-muted">加载中…</p>;
  if (items.length === 0) return <p className="notice">还没有通过地点核验的照片。</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((p) => (
        <li key={p.attemptId}>
          <Link href={`/attempts/${p.attemptId}`} className="card block overflow-hidden no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo via authenticated API */}
            <img src={p.thumbUrl} alt={`${p.placeNameZh} 的照片`} className="aspect-square w-full object-cover" loading="lazy" />
            <div className="flex items-center justify-between gap-2 p-2">
              <span className="truncate text-sm font-semibold">{p.placeNameZh}</span>
              {p.grade ? (
                <span className="grade text-lg text-vermilion" aria-label={`等级 ${p.grade}`}>
                  {p.grade}
                </span>
              ) : (
                <span className="chip">{p.ratingStatus === "pending" ? "评分中" : "无评级"}</span>
              )}
            </div>
            {p.isBest && <p className="px-2 pb-2 text-xs text-line-green">★ 该地点最佳作品</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Stamps({ q, demo }: { q: string; demo: boolean }) {
  const { items, error } = useList<Stamp>(`/me/stamps${q}`);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    apiGet<{ items: { slug: string; nameZh: string }[] }>("/places?limit=100")
      .then((r) => setNames(Object.fromEntries(r.items.map((p) => [p.slug, p.nameZh]))))
      .catch(() => undefined);
  }, []);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!items) return <p className="text-muted">加载中…</p>;
  if (items.length === 0) return <p className="notice">完成定位或拍照打卡即可获得地点印章，完成故事获得故事章。</p>;
  return (
    <ul className="grid grid-cols-2 gap-6 sm:grid-cols-4">
      {items.map((s) => {
        const slug = s.stampKey.split(":")[1] ?? "";
        return (
          <li key={s.stampKey} className="flex flex-col items-center gap-2 text-center">
            <span className={`stamp ${demo ? "stamp-demo" : s.kind === "quest" ? "stamp-quest" : ""}`} aria-hidden>
              {s.kind === "quest" ? "故事\n完成" : (names[slug] ?? slug).slice(0, 6)}
            </span>
            <span className="text-sm font-semibold">{s.kind === "quest" ? "故事完成章" : (names[slug] ?? slug)}</span>
            <span className="text-xs text-muted">{tokyoDate(s.awardedAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Stories({ runs, demo }: { runs: NonNullable<Overview["runs"]>; demo: boolean }) {
  if (runs.length === 0) {
    return (
      <p className="notice">
        还没有领取故事。
        <Link href={demo ? "/demo" : "/quests"} className="ml-1 underline">
          去看看
        </Link>
      </p>
    );
  }
  const label = { active: "进行中", ended_partial: "已结束（未完成）", completed: "已完成" } as Record<string, string>;
  return (
    <ul className="space-y-3">
      {runs.map((r) => (
        <li key={r.runId}>
          <Link href={demo ? `/demo/adventure/${r.runId}` : `/adventures/${r.runId}`} className="ticket flex items-center justify-between gap-3 p-4 no-underline">
            <span>
              <span className="block font-bold">{r.title}</span>
              <span className="text-xs text-muted">
                {r.done}/{r.total} · 开始于 {tokyoDate(r.startedAt)}
              </span>
            </span>
            <span className={`chip ${r.status === "completed" ? "chip-ok" : r.status === "active" ? "chip-info" : "chip-warn"}`}>{label[r.status]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Posters({ q }: { q: string }) {
  const { items, error } = useList<Poster>(`/posters${q}`);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!items) return <p className="text-muted">加载中…</p>;
  if (items.length === 0) return <p className="notice">完成打卡或故事后，可以生成个人纪念票根。</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={`/posters/${p.id}`} className="card block space-y-1 p-3 no-underline">
            <span className="block font-semibold">{p.title}</span>
            <span className="text-xs text-muted">
              {tokyoDate(p.createdAt)} · {p.status === "ready" ? "可下载" : p.status === "failed" ? "生成失败" : "生成中"}
              {p.shared && " · 已分享"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
