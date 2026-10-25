import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreClient } from "@/components/explore/explore-client";

export const metadata: Metadata = { title: "发现附近" };

export default function ExplorePage() {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <ExploreClient />
    </Suspense>
  );
}
