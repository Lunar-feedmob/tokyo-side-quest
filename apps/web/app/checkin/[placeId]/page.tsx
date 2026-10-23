import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppError } from "@tsq/core/http/errors";
import { getPlace } from "@tsq/core/services/places";
import { PhotoSubmit } from "@/components/checkin/photo-submit";

export default function CheckinPlacePage(props: {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ run?: string; step?: string; title?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ placeId: string }>; searchParams: Promise<{ run?: string; step?: string; title?: string }> }) {
  await connection();
  const { placeId } = await params;
  const sp = await searchParams;
  let place;
  try {
    place = await getPlace(placeId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <nav className="text-sm">
        <Link href={sp.run ? `/adventures/${sp.run}` : `/places/${place.slug}`} className="text-ink-2 underline">
          ← 返回
        </Link>
      </nav>
      <h1 className="serif text-2xl font-bold">拍照打卡</h1>
      {place.methods.photo ? (
        <PhotoSubmit
          place={{ id: place.id, nameZh: place.nameZh, nameJa: place.nameJa }}
          quest={sp.run && sp.step ? { runId: sp.run, stepId: sp.step, title: sp.title } : null}
        />
      ) : (
        <p className="notice notice-warn">
          {place.status !== "published" ? "这个地点暂时关闭。" : "这个地点暂不支持照片核验，请使用定位打卡。"}
          <Link href={`/places/${place.slug}`} className="ml-1 underline">
            返回地点
          </Link>
        </p>
      )}
    </div>
  );
}
