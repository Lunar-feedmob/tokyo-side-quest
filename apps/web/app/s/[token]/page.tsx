import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPublicShare } from "@tsq/core/services/posters";

// Public share page: only the poster snapshot, nothing else (spec §14.2).
export const metadata: Metadata = { title: "纪念票根", robots: { index: false, follow: false } };

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <Shared params={params} />
    </Suspense>
  );
}

async function Shared({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const share = await getPublicShare(token).catch(() => null);
  if (!share) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <h1 className="serif text-2xl font-bold">这个分享链接已失效</h1>
        <p className="text-ink-2">链接可能已被撤销、已过期，或对应的内容已删除。</p>
        <Link href="/" className="btn btn-primary">
          了解东京支线
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-5">
      {share.ready ? (
        // eslint-disable-next-line @next/next/no-img-element -- served through a revocable endpoint
        <img src={share.imageUrl} alt={`纪念票根：${share.title}`} width={1080} height={1440} className="h-auto w-full rounded-xl border border-rule" />
      ) : (
        <p className="notice">票根正在更新，请稍后刷新。</p>
      )}
      <div className="text-center">
        <h1 className="serif text-xl font-bold">{share.title}</h1>
        <p className="text-sm text-ink-2">
          {share.subtitle} · {share.dateTokyo}
        </p>
      </div>
      <div className="text-center">
        <Link href="/" className="btn btn-secondary">
          我也想玩：东京支线
        </Link>
      </div>
    </div>
  );
}
