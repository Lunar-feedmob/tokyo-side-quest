import { Suspense } from "react";
import { PosterViewClient } from "@/components/poster/poster-view";

export default function PosterPage({ params }: { params: Promise<{ posterId: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">加载票根…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ posterId: string }> }) {
  const { posterId } = await params;
  return <PosterViewClient posterId={posterId} />;
}
