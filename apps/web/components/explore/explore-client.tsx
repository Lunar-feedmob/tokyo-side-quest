"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCapabilities } from "@/components/env-banner";
import { MapView } from "@/components/map-view";
import { apiGet, apiPost, errorText } from "@/lib/client/api";
import { formatDistance } from "@/lib/client/format";
import type { Neighborhood, PlaceSummary } from "@/lib/client/types";
import { geoMessage, useGeolocation, type GeoReading } from "@/lib/client/use-geolocation";

const RADII = [1500, 3000] as const;

type Source = { kind: "none" } | { kind: "nearby"; reading: GeoReading; radius: number } | { kind: "neighborhood"; slug: string };

export function ExploreClient() {
  const params = useSearchParams();
  const router = useRouter();
  const caps = useCapabilities();
  const geo = useGeolocation();
  const [hoods, setHoods] = useState<Neighborhood[] | null>(null);
  const [hoodError, setHoodError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: "none" });
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const autoLocated = useRef(false);

  useEffect(() => {
    apiGet<{ items: Neighborhood[] }>("/neighborhoods")
      .then((r) => setHoods(r.items))
      .catch((e) => setHoodError(errorText(e)));
  }, []);

  const load = useCallback(async (s: Source) => {
    setSource(s);
    if (s.kind === "none") return;
    setLoading(true);
    setError(null);
    try {
      if (s.kind === "nearby") {
        const r = await apiPost<{ items: PlaceSummary[] }>("/places/nearby", {
          latitude: s.reading.latitude,
          longitude: s.reading.longitude,
          radiusMeters: s.radius,
          limit: 30,
        });
        setPlaces(r.items);
      } else {
        const r = await apiGet<{ items: PlaceSummary[] }>(`/places?neighborhood=${encodeURIComponent(s.slug)}`);
        setPlaces(r.items);
      }
    } catch (e) {
      setError(errorText(e));
      setPlaces(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const locate = useCallback(async () => {
    const reading = await geo.locate();
    if (reading) await load({ kind: "nearby", reading, radius: RADII[0] });
  }, [geo, load]);

  // "发现我附近" on the home page is the user's click; honour it once here.
  useEffect(() => {
    if (params.get("locate") === "1" && !autoLocated.current) {
      autoLocated.current = true;
      router.replace("/explore");
      void locate();
    }
    const hood = params.get("neighborhood");
    if (hood && source.kind === "none") {
      const t = setTimeout(() => void load({ kind: "neighborhood", slug: hood }), 0);
      return () => clearTimeout(t);
    }
  }, [params, router, locate, load, source.kind]);

  const userReading = source.kind === "nearby" ? source.reading : null;
  const hood = source.kind === "neighborhood" ? hoods?.find((h) => h.slug === source.slug) : null;
  const mapCenter = useMemo(
    () => (hood ? { latitude: hood.latitude, longitude: hood.longitude } : null),
    [hood],
  );
  const geoMsg = geoMessage(geo.state);
  const onSelect = useCallback((slug: string) => router.push(`/places/${slug}`), [router]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">发现附近</p>
        <h1 className="serif text-3xl font-bold">附近有什么可以探索？</h1>
      </header>

      <section aria-label="选择位置" className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {geo.state.status === "locating" ? (
            <>
              <span role="status" className="chip chip-info">
                正在获取设备位置…
              </span>
              <button type="button" className="btn btn-quiet" onClick={geo.cancel}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void locate()}>
              {geo.state.status === "success" ? "重新定位" : "发现我附近"}
            </button>
          )}
          <span className="text-sm text-muted">或手动选择街区：</span>
          {hoods === null && !hoodError && <span className="text-sm text-muted">加载中…</span>}
          {hoodError && (
            <span className="text-sm text-vermilion">
              街区列表加载失败。
              <button type="button" className="underline" onClick={() => location.reload()}>
                重试
              </button>
            </span>
          )}
          {hoods?.map((h) => (
            <button
              key={h.slug}
              type="button"
              aria-pressed={source.kind === "neighborhood" && source.slug === h.slug}
              className={`btn ${source.kind === "neighborhood" && source.slug === h.slug ? "btn-secondary bg-paper-2" : "btn-quiet"}`}
              onClick={() => void load({ kind: "neighborhood", slug: h.slug })}
            >
              {h.nameZh}
              <span className="text-xs font-normal text-muted">{h.nameJa}</span>
            </button>
          ))}
        </div>
        {geoMsg && <p className="notice notice-warn text-sm">{geoMsg}</p>}
        {userReading && (
          <p className="text-sm text-ink-2">
            设备报告的位置精度约 ±{userReading.accuracyMeters} m。距离均为
            <strong>直线距离</strong>，不是步行距离。
          </p>
        )}
      </section>

      {source.kind !== "none" && (
        <section aria-label="地点" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="serif text-xl font-bold">
              {source.kind === "nearby" ? `附近 ${formatDistance(source.radius)} 内` : `${hood?.nameZh ?? "街区"}的地点`}
            </h2>
            <div role="tablist" aria-label="浏览方式" className="flex rounded-full bg-paper-2 p-1">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  type="button"
                  className={`min-h-9 rounded-full px-4 text-sm font-semibold ${view === v ? "bg-white shadow-sm" : "text-ink-2"}`}
                  onClick={() => setView(v)}
                >
                  {v === "list" ? "列表" : "地图"}
                </button>
              ))}
            </div>
          </div>

          {loading && <p role="status" className="text-sm text-muted">正在加载地点…</p>}
          {error && (
            <div className="notice notice-danger flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{error}</span>
              <button type="button" className="btn btn-quiet" onClick={() => void load(source)}>
                重试
              </button>
            </div>
          )}

          {view === "map" && (
            <div className="h-[55vh]">
              <MapView
                styleUrl={caps?.map.styleUrl ?? null}
                places={places ?? []}
                user={userReading}
                center={mapCenter}
                onSelect={onSelect}
              />
            </div>
          )}

          {places && places.length === 0 && !loading && (
            <EmptyNearby
              radius={source.kind === "nearby" ? source.radius : null}
              onExpand={source.kind === "nearby" && source.radius < 3000 ? () => void load({ ...source, radius: 3000 }) : null}
              hoods={hoods ?? []}
              onPick={(slug) => void load({ kind: "neighborhood", slug })}
            />
          )}

          {places && places.length > 0 && <PlaceList places={places} />}
        </section>
      )}
    </div>
  );
}

function EmptyNearby(props: { radius: number | null; onExpand: (() => void) | null; hoods: Neighborhood[]; onPick: (slug: string) => void }) {
  return (
    <div className="notice space-y-3">
      <p className="font-semibold">附近暂未收录可探索的地点。</p>
      <p className="text-sm text-ink-2">东京支线目前只开放了下面的街区。你可以手动浏览，或先在线试玩完整流程。</p>
      <div className="flex flex-wrap gap-2">
        {props.onExpand && (
          <button type="button" className="btn btn-quiet" onClick={props.onExpand}>
            扩大到 3 km
          </button>
        )}
        {props.hoods.map((h) => (
          <button key={h.slug} type="button" className="btn btn-secondary" onClick={() => props.onPick(h.slug)}>
            浏览{h.nameZh}
          </button>
        ))}
        <Link href="/demo" className="btn btn-quiet">
          在线试玩
        </Link>
      </div>
    </div>
  );
}

export function PlaceList({ places }: { places: PlaceSummary[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {places.map((p) => (
        <li key={p.id}>
          <Link href={`/places/${p.slug}`} className="card flex h-full flex-col gap-2 p-4 no-underline hover:border-ink">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold leading-snug">{p.nameZh}</p>
                <p className="text-sm text-ink-2" lang="ja">
                  {p.nameJa}
                </p>
              </div>
              {p.explored ? <span className="chip chip-ok">✓ 已探索</span> : <span className="chip">未探索</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
              {p.distanceMeters !== undefined && <span>直线距离 {formatDistance(p.distanceMeters)}</span>}
              {p.stayMinutes && <span>建议停留 约 {p.stayMinutes} 分钟</span>}
              <span>{p.photoEnabled ? "定位 / 拍照打卡" : "定位打卡"}</span>
              {p.status === "temporarily_closed" && <span className="chip chip-warn">暂停打卡</span>}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
