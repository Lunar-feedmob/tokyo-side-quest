import type { Metadata } from "next";
import { Suspense } from "react";
import { MeClient } from "@/components/me/me-client";

export const metadata: Metadata = { title: "我的东京" };

export default function MePage() {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <MeClient />
    </Suspense>
  );
}
