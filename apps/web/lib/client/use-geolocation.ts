"use client";

import { useCallback, useRef, useState } from "react";

// Explicit, user-triggered geolocation (spec §4.3, §5.1). Never requested on
// page load; no retry loop after a denial.

export type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "success"; position: GeoReading }
  | { status: "denied" }
  | { status: "timeout" }
  | { status: "unavailable"; reason: "insecure" | "unsupported" | "error" };

export interface GeoReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

const INITIAL_TIMEOUT_MS = 12_000;

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const cancelled = useRef(false);

  const locate = useCallback((): Promise<GeoReading | null> => {
    cancelled.current = false;
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "unavailable", reason: "unsupported" });
      return Promise.resolve(null);
    }
    if (!window.isSecureContext) {
      setState({ status: "unavailable", reason: "insecure" });
      return Promise.resolve(null);
    }
    setState({ status: "locating" });
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled.current) return resolve(null);
          const reading: GeoReading = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: Math.round(pos.coords.accuracy),
            capturedAt: new Date(pos.timestamp).toISOString(),
          };
          setState({ status: "success", position: reading });
          resolve(reading);
        },
        (err) => {
          if (cancelled.current) return resolve(null);
          if (err.code === err.PERMISSION_DENIED) setState({ status: "denied" });
          else if (err.code === err.TIMEOUT) setState({ status: "timeout" });
          else setState({ status: "unavailable", reason: "error" });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: INITIAL_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    setState({ status: "idle" });
  }, []);

  return { state, locate, cancel };
}

export function geoMessage(state: GeoState): string | null {
  switch (state.status) {
    case "denied":
      return "你没有允许定位。可以在浏览器的网站设置中开启定位权限，也可以直接手动选择街区。";
    case "timeout":
      return "定位超时。可以到开阔处重新获取，或先手动浏览街区。";
    case "unavailable":
      return state.reason === "insecure"
        ? "当前页面不是安全连接（HTTPS），浏览器不允许定位。请使用 HTTPS 地址访问。"
        : state.reason === "unsupported"
          ? "这个浏览器不支持定位。可以手动选择街区浏览。"
          : "暂时无法取得位置，请稍后重试或手动选择街区。";
    default:
      return null;
  }
}
