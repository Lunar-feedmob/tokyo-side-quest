import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/client";
import { neighborhoods, placeProgress, places, placeVersions, referenceImages, type PlaceContent } from "../db/schema";
import type { Mode } from "../domain/status";
import { AppError } from "../http/errors";

// Read models for places. Coordinates are always exposed as
// { latitude, longitude } to avoid lng/lat order mix-ups.

export interface PlaceSummary {
  id: string;
  slug: string;
  nameZh: string;
  nameJa: string;
  nameEn: string | null;
  latitude: number;
  longitude: number;
  status: string;
  radiusMeters: number;
  photoEnabled: boolean;
  tags: string[];
  stayMinutes: number | null;
  neighborhoodSlug: string;
  distanceMeters?: number;
  distanceType?: "straight_line";
  explored?: boolean;
}

const summaryColumns = {
  id: places.id,
  slug: places.slug,
  nameZh: places.nameZh,
  nameJa: places.nameJa,
  nameEn: places.nameEn,
  latitude: sql<number>`ST_Y(${places.geo}::geometry)`.mapWith(Number),
  longitude: sql<number>`ST_X(${places.geo}::geometry)`.mapWith(Number),
  status: places.status,
  radiusMeters: places.radiusM,
  photoEnabled: places.photoEnabled,
  tags: places.tags,
  stayMinutes: places.stayMinutes,
  neighborhoodSlug: neighborhoods.slug,
};

/** Places a visitor can browse: published plus temporarily closed (shown, but check-in disabled). */
const visibleStatus = inArray(places.status, ["published", "temporarily_closed"]);

export async function listNeighborhoods() {
  return db()
    .select({
      id: neighborhoods.id,
      slug: neighborhoods.slug,
      nameZh: neighborhoods.nameZh,
      nameJa: neighborhoods.nameJa,
      nameEn: neighborhoods.nameEn,
      summary: neighborhoods.summary,
      latitude: sql<number>`ST_Y(${neighborhoods.center}::geometry)`.mapWith(Number),
      longitude: sql<number>`ST_X(${neighborhoods.center}::geometry)`.mapWith(Number),
    })
    .from(neighborhoods)
    .where(eq(neighborhoods.status, "published"))
    .orderBy(asc(neighborhoods.sortOrder));
}

async function withExplored(rows: PlaceSummary[], visitorId: string | null, mode: Mode): Promise<PlaceSummary[]> {
  if (!visitorId || rows.length === 0) return rows;
  const progress = await db()
    .select({ placeId: placeProgress.placeId })
    .from(placeProgress)
    .where(
      and(
        eq(placeProgress.visitorId, visitorId),
        eq(placeProgress.mode, mode),
        inArray(
          placeProgress.placeId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const done = new Set(progress.map((p) => p.placeId));
  return rows.map((r) => ({ ...r, explored: done.has(r.id) }));
}

export async function listPlaces(opts: {
  neighborhoodSlug?: string;
  visitorId: string | null;
  mode: Mode;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.neighborhoodSlug
    ? and(visibleStatus, eq(neighborhoods.slug, opts.neighborhoodSlug))
    : visibleStatus;
  const rows = await db()
    .select(summaryColumns)
    .from(places)
    .innerJoin(neighborhoods, eq(neighborhoods.id, places.neighborhoodId))
    .where(where)
    .orderBy(asc(places.slug))
    .limit(limit + 1)
    .offset(offset);
  const page = rows.slice(0, limit);
  return { items: await withExplored(page, opts.visitorId, opts.mode), hasMore: rows.length > limit, offset, limit };
}

/** Parameterised PostGIS query: ST_DWithin on geography uses metres (spec §10.2). */
export async function nearbyPlaces(opts: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
  visitorId: string | null;
  mode: Mode;
}) {
  const origin = sql`ST_SetSRID(ST_MakePoint(${opts.longitude}, ${opts.latitude}), 4326)::geography`;
  const rows = await db()
    .select({ ...summaryColumns, distanceMeters: sql<number>`ST_Distance(${places.geo}, ${origin})`.mapWith(Number) })
    .from(places)
    .innerJoin(neighborhoods, eq(neighborhoods.id, places.neighborhoodId))
    .where(and(visibleStatus, sql`ST_DWithin(${places.geo}, ${origin}, ${opts.radiusMeters})`))
    .orderBy(sql`ST_Distance(${places.geo}, ${origin})`)
    .limit(opts.limit);
  const items = rows.map((r) => ({ ...r, distanceMeters: Math.round(r.distanceMeters), distanceType: "straight_line" as const }));
  return withExplored(items, opts.visitorId, opts.mode);
}

export interface PlaceDetail extends PlaceSummary {
  versionId: string | null;
  version: number | null;
  content: PlaceContent | null;
  referenceVersion: string | null;
  publishedAt: Date | null;
  references: { id: string; viewNote: string; author: string; license: string; sourceUrl: string; publicDisplay: boolean }[];
  methods: { location: boolean; photo: boolean };
}

export async function getPlace(idOrSlug: string): Promise<PlaceDetail> {
  const isUuid = /^[0-9a-f-]{36}$/iu.test(idOrSlug);
  const [row] = await db()
    .select({ ...summaryColumns, publishedVersionId: places.publishedVersionId })
    .from(places)
    .innerJoin(neighborhoods, eq(neighborhoods.id, places.neighborhoodId))
    .where(and(visibleStatus, isUuid ? eq(places.id, idOrSlug) : eq(places.slug, idOrSlug)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "没有找到这个地点");

  const version = row.publishedVersionId
    ? (await db().select().from(placeVersions).where(eq(placeVersions.id, row.publishedVersionId)).limit(1))[0]
    : undefined;
  const refs =
    version && version.referenceImageIds.length > 0
      ? await db()
          .select({
            id: referenceImages.id,
            viewNote: referenceImages.viewNote,
            author: referenceImages.author,
            license: referenceImages.license,
            sourceUrl: referenceImages.sourceUrl,
            publicDisplay: referenceImages.publicDisplay,
          })
          .from(referenceImages)
          .where(inArray(referenceImages.id, version.referenceImageIds))
      : [];

  const open = row.status === "published";
  const photoReady = Boolean(version?.photoEnabled && row.photoEnabled && version.referenceImageIds.length >= 3);
  return {
    ...row,
    versionId: version?.id ?? null,
    version: version?.version ?? null,
    content: version?.content ?? null,
    referenceVersion: version?.referenceVersion ?? null,
    publishedAt: version?.publishedAt ?? null,
    references: refs,
    methods: { location: open, photo: open && photoReady },
  };
}

/** Lock-free load of everything check-in rules need, from the current published version. */
export async function loadCheckinPlace(tx: DbOrTx, placeId: string) {
  const [row] = await tx
    .select({
      id: places.id,
      slug: places.slug,
      status: places.status,
      radiusMeters: places.radiusM,
      photoEnabled: places.photoEnabled,
      latitude: summaryColumns.latitude,
      longitude: summaryColumns.longitude,
      versionId: places.publishedVersionId,
    })
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);
  if (!row || row.status === "draft" || row.status === "archived" || !row.versionId) {
    throw new AppError("NOT_FOUND", "没有找到这个地点");
  }
  if (row.status !== "published") {
    throw new AppError("PLACE_UNAVAILABLE", "这个地点暂时关闭，暂不接受新的打卡");
  }
  return row as typeof row & { versionId: string };
}
