"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre renders whatever style MAP_STYLE_URL points at (spec §7.2). With no
// configured style the component says so and the list remains the primary UI.

export interface MapPlace {
  id: string;
  slug: string;
  nameZh: string;
  latitude: number;
  longitude: number;
  explored?: boolean;
}

export function MapView(props: {
  styleUrl: string | null;
  places: MapPlace[];
  user?: { latitude: number; longitude: number; accuracyMeters: number } | null;
  center?: { latitude: number; longitude: number } | null;
  onSelect?: (slug: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const { styleUrl, places, user, center, onSelect } = props;
  // Initial camera only; later changes are applied by the marker effect below.
  const initialCenter = useRef(props.center ?? props.places[0] ?? { latitude: 35.7272, longitude: 139.7665 });

  useEffect(() => {
    if (!styleUrl || !container.current) return;
    let disposed = false;
    import("maplibre-gl")
      .then(({ default: maplibregl }) => {
        if (disposed || !container.current) return;
        const c = initialCenter.current;
        const map = new maplibregl.Map({
          container: container.current,
          style: styleUrl,
          center: [c.longitude, c.latitude],
          zoom: 15.5,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", (e) => {
          if (!map.isStyleLoaded()) setFailed(true);
          console.warn("map error", e.error?.message);
        });
        map.on("load", () => setReady(true));
        mapRef.current = map;
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      for (const p of places) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `grid h-9 min-w-9 place-items-center rounded-full border-2 border-white px-2 text-xs font-bold text-white shadow ${p.explored ? "bg-[#246b58]" : "bg-[#c7372f]"}`;
        el.textContent = p.explored ? "✓" : "●";
        el.setAttribute("aria-label", `${p.nameZh}${p.explored ? "（已探索）" : ""}`);
        el.addEventListener("click", () => onSelect?.(p.slug));
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map));
      }
      if (user) {
        const el = document.createElement("div");
        el.className = "h-4 w-4 rounded-full border-2 border-white bg-[#295c89] shadow";
        el.setAttribute("aria-label", "设备报告的位置");
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([user.longitude, user.latitude]).addTo(map));
        map.easeTo({ center: [user.longitude, user.latitude] });
      } else if (center) {
        map.easeTo({ center: [center.longitude, center.latitude] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, places, user, center, onSelect]);

  if (!props.styleUrl || failed) {
    return (
      <div className="grid h-full min-h-48 place-items-center rounded-xl border border-dashed border-rule bg-paper-2 p-6 text-center text-sm text-ink-2">
        <p>
          {failed ? "地图加载失败。" : "地图暂不可用（尚未配置底图服务）。"}
          <br />
          下方地点列表与外部导航可以正常使用。
        </p>
      </div>
    );
  }
  return <div ref={container} className="h-full min-h-64 w-full overflow-hidden rounded-xl border border-rule" role="region" aria-label="地点地图" />;
}
