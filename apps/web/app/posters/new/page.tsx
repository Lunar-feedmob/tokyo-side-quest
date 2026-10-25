import { Suspense } from "react";
import { PosterEditor } from "@/components/poster/poster-editor";

export default function NewPosterPage() {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <PosterEditor />
    </Suspense>
  );
}
