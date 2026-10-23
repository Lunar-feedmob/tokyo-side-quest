"use client";

import { formatDistance } from "@/lib/client/format";
import { geoMessage, useGeolocation } from "@/lib/client/use-geolocation";

// Informational only: the check-in decision is always recomputed on the server.
function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function DistanceCheck({ place }: { place: { latitude: number; longitude: number; radiusMeters: number } }) {
  const geo = useGeolocation();
  const msg = geoMessage(geo.state);
  return (
    <div className="space-y-1 text-sm">
      {geo.state.status === "success" ? (
        <p>
          距离约 <strong>{formatDistance(haversine(geo.state.position, place))}</strong>（直线），定位精度 ±{geo.state.position.accuracyMeters} m。
          <button type="button" className="ml-1 underline" onClick={() => void geo.locate()}>
            刷新
          </button>
        </p>
      ) : (
        <button type="button" className="underline" onClick={() => void geo.locate()} disabled={geo.state.status === "locating"}>
          {geo.state.status === "locating" ? "正在定位…" : "看看我离这里多远"}
        </button>
      )}
      {msg && <p className="text-xs text-warn">{msg}</p>}
    </div>
  );
}
