import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppError } from "@tsq/core/http/errors";
import { getPlace } from "@tsq/core/services/places";
import { PlaceActions } from "@/components/place/place-actions";
import { SourceList } from "@/components/place/source-list";

export default function PlacePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">加载地点…</p>}>
      <PlaceContent params={params} />
    </Suspense>
  );
}

async function PlaceContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  let place;
  try {
    place = await getPlace(decodeURIComponent(slug));
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const c = place.content;
  const publicRefs = place.references.filter((r) => r.publicDisplay);
  const closed = place.status !== "published";

  return (
    <article className="space-y-8">
      <nav className="text-sm">
        <Link href={`/explore?neighborhood=${place.neighborhoodSlug}`} className="text-ink-2 underline">
          ← 返回地点列表
        </Link>
      </nav>
      <header className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {place.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
          {closed && <span className="chip chip-warn">暂时关闭 · 不接受新打卡</span>}
        </div>
        <h1 className="serif text-3xl font-bold leading-tight">{place.nameZh}</h1>
        <p className="text-lg text-ink-2" lang="ja">
          {place.nameJa}
          {place.nameEn && <span className="ml-2 text-sm text-muted" lang="en">{place.nameEn}</span>}
        </p>
      </header>

      <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {c && (
            <section aria-labelledby="intro" className="space-y-2">
              <h2 id="intro" className="eyebrow">
                地点介绍 · 真实资料
              </h2>
              <p>{c.intro}</p>
            </section>
          )}
          {c && (
            <section aria-labelledby="culture" className="card space-y-2 p-4">
              <h2 id="culture" className="font-bold">
                文化观察
              </h2>
              <p className="text-ink-2">{c.cultureNote}</p>
              <SourceList sources={c.cultureSources} />
            </section>
          )}
          {c && (
            <section aria-labelledby="tips" className="space-y-2">
              <h2 id="tips" className="font-bold">
                拍摄提示
              </h2>
              <p className="text-ink-2">{c.shootingTips}</p>
              {c.distinctiveFeatures.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                  {c.distinctiveFeatures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {c.unsuitableAngles.length > 0 && (
                <p className="text-sm text-muted">不适合用于核验：{c.unsuitableAngles.join("；")}</p>
              )}
            </section>
          )}
          <section aria-labelledby="restrict" className="space-y-2">
            <h2 id="restrict" className="font-bold">
              开放与拍摄须知
            </h2>
            {c?.restrictions && c.restrictions.length > 0 ? (
              <ul className="space-y-2 text-sm text-ink-2">
                {c.restrictions.map((r) => (
                  <li key={r.text} className="notice">
                    {r.text}
                    {r.source && <SourceList sources={[r.source]} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">开放时间与拍摄限制：未找到可核实的来源（未知）。请以现场告示为准。</p>
            )}
          </section>
          {publicRefs.length > 0 && (
            <section aria-labelledby="refs" className="space-y-2">
              <h2 id="refs" className="font-bold">
                参考照片
              </h2>
              <ul className="grid grid-cols-2 gap-3">
                {publicRefs.map((r) => (
                  <li key={r.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private storage proxied via our API */}
                    <img
                      src={`/api/v1/places/${place.id}/references/${r.id}/image`}
                      alt={`${place.nameZh} 参考照片`}
                      className="aspect-[4/3] w-full rounded-lg object-cover"
                      loading="lazy"
                    />
                    <p className="text-xs text-muted">
                      {r.author} ·{" "}
                      <a href={r.sourceUrl} className="underline" target="_blank" rel="noreferrer">
                        {r.license}
                      </a>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-muted">
            资料版本 v{place.version ?? "-"}
            {place.publishedAt && ` · 更新于 ${new Date(place.publishedAt).toISOString().slice(0, 10)}`}
            {c?.verificationLevel === "desk" && " · 坐标与资料为桌面核对，尚未实地核验"}
            {c?.coordinateSource && (
              <>
                {" · 坐标来源："}
                <a href={c.coordinateSource.url} className="underline" target="_blank" rel="noreferrer">
                  {c.coordinateSource.label}
                </a>
              </>
            )}
          </p>
        </div>

        <aside className="space-y-4">
          <PlaceActions
            place={{
              id: place.id,
              slug: place.slug,
              nameZh: place.nameZh,
              nameJa: place.nameJa,
              latitude: place.latitude,
              longitude: place.longitude,
              radiusMeters: place.radiusMeters,
              methods: place.methods,
              closed,
            }}
          />
        </aside>
      </div>
    </article>
  );
}
