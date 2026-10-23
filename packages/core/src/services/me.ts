import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assets, checkins, photoAttempts, photoRatings, places, posters, stampAwards } from "../db/schema";
import type { Mode } from "../domain/status";
import { listMyRuns } from "./quests";

// "我的东京" read models. Footprints count only location-qualified records
// (spec §4.7); photo-only matches are labelled as such and never as visits.

export async function overview(visitorId: string, mode: Mode) {
  const [footprints] = await db()
    .select({ n: sql<number>`count(distinct ${checkins.placeId})`.mapWith(Number) })
    .from(checkins)
    .where(and(eq(checkins.visitorId, visitorId), eq(checkins.mode, mode), eq(checkins.arrivalVerified, true)));
  const [photos] = await db()
    .select({ n: count() })
    .from(photoRatings)
    .innerJoin(photoAttempts, eq(photoAttempts.id, photoRatings.attemptId))
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .where(and(eq(photoRatings.visitorId, visitorId), eq(photoRatings.mode, mode), eq(assets.state, "ready")));
  const [stamps] = await db()
    .select({ n: count() })
    .from(stampAwards)
    .where(and(eq(stampAwards.visitorId, visitorId), eq(stampAwards.mode, mode)));
  const [posterCount] = await db()
    .select({ n: count() })
    .from(posters)
    .where(and(eq(posters.ownerVisitorId, visitorId), eq(posters.mode, mode), sql`${posters.status} <> 'deleted'`));
  const runs = await listMyRuns({ visitorId, mode });
  return {
    mode,
    counts: { footprints: footprints?.n ?? 0, photos: photos?.n ?? 0, stamps: stamps?.n ?? 0, posters: posterCount?.n ?? 0 },
    activeRuns: runs.filter((r) => r.status === "active"),
    runs,
  };
}

export async function myCheckins(visitorId: string, mode: Mode, limit = 50, offset = 0) {
  const rows = await db()
    .select({
      id: checkins.id,
      placeId: checkins.placeId,
      placeSlug: places.slug,
      placeNameZh: places.nameZh,
      placeNameJa: places.nameJa,
      method: checkins.method,
      arrivalVerified: checkins.arrivalVerified,
      simulated: checkins.simulated,
      distanceMeters: checkins.distanceMeters,
      accuracyMeters: checkins.accuracyMeters,
      attemptId: checkins.attemptId,
      acceptedAt: checkins.acceptedAt,
    })
    .from(checkins)
    .innerJoin(places, eq(places.id, checkins.placeId))
    .where(and(eq(checkins.visitorId, visitorId), eq(checkins.mode, mode)))
    .orderBy(desc(checkins.acceptedAt))
    .limit(Math.min(limit, 100) + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map((r) => ({
      ...r,
      label:
        r.method === "location"
          ? r.simulated
            ? "位置符合范围 · 模拟定位"
            : "位置符合范围（设备位置报告）"
          : r.arrivalVerified
            ? "照片匹配 · 位置符合范围"
            : "照片地点匹配 · 未核验到访",
    })),
    hasMore: rows.length > limit,
  };
}

export async function myPhotos(visitorId: string, mode: Mode, limit = 50, offset = 0) {
  const rows = await db()
    .select({
      attemptId: photoAttempts.id,
      assetId: photoAttempts.assetId,
      assetKind: assets.kind,
      sampleKey: photoAttempts.sampleKey,
      placeId: places.id,
      placeSlug: places.slug,
      placeNameZh: places.nameZh,
      grade: photoRatings.grade,
      total: photoRatings.total,
      rubricVersion: photoRatings.rubricVersion,
      ratingStatus: photoAttempts.ratingStatus,
      createdAt: photoAttempts.createdAt,
      isBest: sql<boolean>`exists (select 1 from place_progress pp where pp.best_rating_id = ${photoRatings.id})`,
    })
    .from(photoAttempts)
    .innerJoin(places, eq(places.id, photoAttempts.placeId))
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .leftJoin(photoRatings, eq(photoRatings.attemptId, photoAttempts.id))
    .where(
      and(
        eq(photoAttempts.visitorId, visitorId),
        eq(photoAttempts.mode, mode),
        eq(photoAttempts.verificationStatus, "matched"),
        eq(assets.state, "ready"),
        sql`${photoAttempts.cancelledAt} is null`,
      ),
    )
    .orderBy(desc(photoAttempts.createdAt))
    .limit(Math.min(limit, 100) + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map((r) => ({
      ...r,
      thumbUrl:
        r.assetKind === "sample"
          ? `/api/v1/demo/samples/${encodeURIComponent(r.sampleKey ?? "")}/image`
          : `/api/v1/photos/${r.assetId}/thumb`,
      label: mode === "demo" ? "试玩样例" : "照片地点匹配",
    })),
    hasMore: rows.length > limit,
  };
}

export async function myStamps(visitorId: string, mode: Mode) {
  return db()
    .select({ stampKey: stampAwards.stampKey, kind: stampAwards.kind, awardedAt: stampAwards.awardedAt })
    .from(stampAwards)
    .where(and(eq(stampAwards.visitorId, visitorId), eq(stampAwards.mode, mode)))
    .orderBy(stampAwards.awardedAt);
}
