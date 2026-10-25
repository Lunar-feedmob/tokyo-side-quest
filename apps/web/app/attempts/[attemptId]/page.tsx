import { Suspense } from "react";
import { AttemptClient } from "@/components/attempt/attempt-client";

export default function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  return (
    <div className="mx-auto max-w-xl">
      <Suspense fallback={<p className="text-muted">正在读取结果…</p>}>
        <AttemptLoader params={params} />
      </Suspense>
    </div>
  );
}

async function AttemptLoader({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <AttemptClient attemptId={attemptId} />;
}
