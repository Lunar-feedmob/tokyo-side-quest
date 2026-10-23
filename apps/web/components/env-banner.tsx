"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client/api";

interface Caps {
  ai: { available: boolean; testDouble: boolean };
  storage: { available: boolean };
  map: { available: boolean; styleUrl: string | null };
  demo: boolean;
  simulatedLocation: boolean;
  testEnvironment: boolean;
}

let capsPromise: Promise<Caps> | null = null;
export function loadCapabilities(): Promise<Caps> {
  capsPromise ??= apiGet<Caps>("/capabilities").catch((e) => {
    capsPromise = null;
    throw e;
  });
  return capsPromise;
}

export function useCapabilities(): Caps | null {
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    loadCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  return caps;
}

/** Persistent marker for test environments: fake AI or simulated location (spec §5.1). */
export function EnvBanner() {
  const caps = useCapabilities();
  if (!caps || (!caps.testEnvironment && !caps.simulatedLocation)) return null;
  return (
    <div role="status" className="bg-ink px-4 py-1.5 text-center text-xs font-semibold text-white">
      测试环境
      {caps.ai.testDouble && " · AI 为测试替身，结果不是真实识别"}
      {caps.simulatedLocation && " · 已启用模拟定位"}
    </div>
  );
}
