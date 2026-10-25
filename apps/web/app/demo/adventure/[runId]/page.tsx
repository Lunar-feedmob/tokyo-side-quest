import { Suspense } from "react";
import { AdventureClient } from "@/components/quest/adventure-client";

export default function AdventurePage({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">加载故事进度…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <AdventureClient runId={runId} mode="demo" />;
}
