import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listPlaces } from "@tsq/core/services/places";

// The global "拍照打卡" entry asks for the target place first; a photo is never
// submitted without one (spec §3.1).
export default function CheckinIndexPage() {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="serif text-2xl font-bold">拍照打卡</h1>
      <p className="text-ink-2">先选择你要打卡的地点。AI 只会核对照片是否与这个地点一致。</p>
      <Suspense fallback={<p className="text-muted">加载地点…</p>}>
        <PlacePicker />
      </Suspense>
    </div>
  );
}

async function PlacePicker() {
  await connection();
  const { items } = await listPlaces({ visitorId: null, mode: "live", limit: 100 });
  const photo = items.filter((p) => p.photoEnabled && p.status === "published");
  const locationOnly = items.filter((p) => !p.photoEnabled || p.status !== "published");
  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {photo.map((p) => (
          <li key={p.id}>
            <Link href={`/checkin/${p.id}`} className="card flex items-center justify-between gap-3 p-4 no-underline hover:border-ink">
              <span>
                <span className="block font-bold">{p.nameZh}</span>
                <span className="text-sm text-ink-2" lang="ja">
                  {p.nameJa}
                </span>
              </span>
              <span aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
      {locationOnly.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">以下地点只支持定位打卡</h2>
          <ul className="flex flex-wrap gap-2">
            {locationOnly.map((p) => (
              <li key={p.id}>
                <Link href={`/places/${p.slug}`} className="chip">
                  {p.nameZh}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
