import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  aiCalls,
  assets,
  auditLogs,
  neighborhoods,
  photoAttempts,
  placeVerifications,
  placeVersions,
  places,
  quests,
  questSteps,
  questVersions,
  referenceImages,
  reviewRequests,
  type PlaceContent,
} from "../db/schema";
import { PLACE_STATUSES, PROOF_POLICIES } from "../domain/status";
import { AppError } from "../http/errors";
import { getObject } from "../storage/s3";
import { audit, type AdminPrincipal } from "./admin-auth";
import { activeRunsUsingPlace, addReferenceImage, createQuestVersion, publishPlace, publishQuestVersion } from "./content";
import { acceptMatchedAttempt } from "./processing";

// Back-office operations (spec §4.8). Every mutating call records an audit
// entry with the acting admin taken from the session, never from the request.

// ── Reviews ─────────────────────────────────────────────────────────────────

export async function listReviews(status: "open" | "approved" | "rejected" = "open") {
  return db()
    .select({
      id: reviewRequests.id,
      status: reviewRequests.status,
      note: reviewRequests.note,
      reason: reviewRequests.reason,
      createdAt: reviewRequests.createdAt,
      decidedAt: reviewRequests.decidedAt,
      attemptId: photoAttempts.id,
      placeId: places.id,
      placeNameZh: places.nameZh,
      placeSlug: places.slug,
    })
    .from(reviewRequests)
    .innerJoin(photoAttempts, eq(photoAttempts.id, reviewRequests.attemptId))
    .innerJoin(places, eq(places.id, photoAttempts.placeId))
    .where(eq(reviewRequests.status, status))
    .orderBy(status === "open" ? asc(reviewRequests.createdAt) : desc(reviewRequests.decidedAt))
    .limit(100);
}

export async function getReview(reviewId: string) {
  const [row] = await db()
    .select({ review: reviewRequests, attempt: photoAttempts, place: { id: places.id, nameZh: places.nameZh, nameJa: places.nameJa } })
    .from(reviewRequests)
    .innerJoin(photoAttempts, eq(photoAttempts.id, reviewRequests.attemptId))
    .innerJoin(places, eq(places.id, photoAttempts.placeId))
    .where(eq(reviewRequests.id, reviewId));
  if (!row) throw new AppError("NOT_FOUND", "复核请求不存在");
  const verifications = await db()
    .select()
    .from(placeVerifications)
    .where(eq(placeVerifications.attemptId, row.attempt.id))
    .orderBy(asc(placeVerifications.createdAt));
  const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, row.attempt.placeVersionId));
  const refs = version?.referenceImageIds.length
    ? await db()
        .select({ id: referenceImages.id, viewNote: referenceImages.viewNote })
        .from(referenceImages)
        .where(inArray(referenceImages.id, version.referenceImageIds))
    : [];
  return {
    review: row.review,
    attempt: {
      id: row.attempt.id,
      verificationStatus: row.attempt.verificationStatus,
      ratingStatus: row.attempt.ratingStatus,
      createdAt: row.attempt.createdAt,
      cancelled: Boolean(row.attempt.cancelledAt),
    },
    place: row.place,
    features: version?.content.distinctiveFeatures ?? [],
    verifications,
    references: refs.map((r) => ({ ...r, imageUrl: `/api/v1/admin/references/${r.id}/image` })),
    photoUrl: `/api/v1/admin/reviews/${reviewId}/photo`,
  };
}

/** Photo bytes for an open review. Reading is logged (spec §15). */
export async function reviewPhoto(admin: AdminPrincipal, reviewId: string) {
  const [row] = await db()
    .select({ key: assets.objectKey, state: assets.state, status: reviewRequests.status })
    .from(reviewRequests)
    .innerJoin(photoAttempts, eq(photoAttempts.id, reviewRequests.attemptId))
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .where(eq(reviewRequests.id, reviewId));
  if (!row || row.state !== "ready") throw new AppError("NOT_FOUND", "照片不存在或已删除");
  await audit({ actorType: "admin", actorId: admin.id, action: "review.photo_viewed", targetType: "review", targetId: reviewId });
  return getObject(row.key);
}

export async function referenceImageBytes(refId: string) {
  const [row] = await db()
    .select({ key: assets.thumbKey, main: assets.objectKey })
    .from(referenceImages)
    .innerJoin(assets, eq(assets.id, referenceImages.assetId))
    .where(eq(referenceImages.id, refId));
  if (!row) throw new AppError("NOT_FOUND", "参考图不存在");
  return getObject(row.key ?? row.main);
}

export async function decideReview(admin: AdminPrincipal, reviewId: string, decision: "approve" | "reject", reason: string) {
  return db().transaction(async (tx) => {
    const [review] = await tx.select().from(reviewRequests).where(eq(reviewRequests.id, reviewId)).for("update");
    if (!review) throw new AppError("NOT_FOUND", "复核请求不存在");
    // Repeated submissions of a decision are no-ops: no double rewards.
    if (review.status !== "open") return { reviewId, status: review.status, changed: false };

    const [attempt] = await tx.select().from(photoAttempts).where(eq(photoAttempts.id, review.attemptId)).for("update");
    if (!attempt) throw new AppError("NOT_FOUND", "照片打卡不存在");
    const [asset] = await tx.select({ state: assets.state }).from(assets).where(eq(assets.id, attempt.assetId));
    if (attempt.cancelledAt || asset?.state !== "ready") {
      await tx.update(reviewRequests).set({ status: "cancelled", decidedAt: new Date(), reason: "照片已删除" }).where(eq(reviewRequests.id, reviewId));
      return { reviewId, status: "cancelled" as const, changed: true };
    }
    if (attempt.verificationStatus !== "uncertain") {
      throw new AppError("REVIEW_NOT_ALLOWED", "只有“无法确认”的结果可以人工复核");
    }

    // The AI verdict stays in place_verifications; the human decision is appended.
    await tx.insert(placeVerifications).values({
      attemptId: attempt.id,
      source: "human",
      verdict: decision === "approve" ? "matched" : "uncertain",
      reasonCode: decision === "approve" ? "distinctive_features_match" : "insufficient_evidence",
      evidence: [],
      userMessage: decision === "approve" ? "人工复核确认照片与地点一致。" : `人工复核未通过：${reason}`,
      reshootSuggestion: null,
      reviewerId: admin.id,
      reviewReason: reason,
    });
    await tx
      .update(reviewRequests)
      .set({ status: decision === "approve" ? "approved" : "rejected", reviewerId: admin.id, reason, decidedAt: new Date() })
      .where(eq(reviewRequests.id, reviewId));
    if (decision === "approve") {
      await acceptMatchedAttempt(tx, attempt);
    }
    await tx.insert(auditLogs).values({
      actorType: "admin",
      actorId: admin.id,
      action: `review.${decision}`,
      targetType: "photo_attempt",
      targetId: attempt.id,
      reason,
    });
    return { reviewId, status: decision === "approve" ? ("approved" as const) : ("rejected" as const), changed: true };
  });
}

// ── Places ──────────────────────────────────────────────────────────────────

export async function adminListPlaces() {
  return db()
    .select({
      id: places.id,
      slug: places.slug,
      nameZh: places.nameZh,
      nameJa: places.nameJa,
      status: places.status,
      radiusM: places.radiusM,
      photoEnabled: places.photoEnabled,
      latitude: sql<number>`ST_Y(${places.geo}::geometry)`.mapWith(Number),
      longitude: sql<number>`ST_X(${places.geo}::geometry)`.mapWith(Number),
      publishedVersion: sql<number | null>`(select version from place_versions v where v.id = ${places.publishedVersionId})`,
      // Qualified on purpose: an unqualified "id" inside the subquery would bind to reference_images.id.
      referenceCount: sql<number>`(select count(*) from reference_images r where r.place_id = "places"."id" and r.status = 'active')`.mapWith(Number),
      updatedAt: places.updatedAt,
    })
    .from(places)
    .orderBy(asc(places.slug));
}

const sourceRef = z.object({ label: z.string().min(1), url: z.url(), accessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), note: z.string().optional() });

export const placeContentSchema = z.object({
  intro: z.string().min(10).max(400),
  cultureNote: z.string().min(5).max(400),
  cultureSources: z.array(sourceRef).min(1),
  shootingTips: z.string().max(300),
  distinctiveFeatures: z.array(z.string().min(2).max(120)).max(10),
  confusablePlaces: z.array(z.string().max(160)).max(10),
  unsuitableAngles: z.array(z.string().max(120)).max(10),
  restrictions: z.array(z.object({ text: z.string().min(2).max(500), source: sourceRef.optional() })).nullable(),
  coordinateSource: sourceRef,
  verificationLevel: z.enum(["desk", "field"]),
  storyLink: z.string().optional(),
});

export const placeUpsertSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/u),
  neighborhoodSlug: z.string(),
  nameZh: z.string().min(1).max(60),
  nameJa: z.string().min(1).max(60),
  nameEn: z.string().max(80).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().int().min(10).max(500),
  photoEnabled: z.boolean(),
  tags: z.array(z.string().max(12)).max(6),
  stayMinutes: z.number().int().min(1).max(240).nullable(),
  content: placeContentSchema,
});

export const placePatchSchema = placeUpsertSchema.partial().extend({ status: z.enum(PLACE_STATUSES).optional() });

const point = (lat: number, lng: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

export async function adminCreatePlace(admin: AdminPrincipal, input: z.infer<typeof placeUpsertSchema>) {
  const [hood] = await db().select({ id: neighborhoods.id }).from(neighborhoods).where(eq(neighborhoods.slug, input.neighborhoodSlug));
  if (!hood) throw new AppError("VALIDATION_ERROR", "街区不存在");
  const [row] = await db()
    .insert(places)
    .values({
      slug: input.slug,
      neighborhoodId: hood.id,
      nameZh: input.nameZh,
      nameJa: input.nameJa,
      nameEn: input.nameEn,
      geo: point(input.latitude, input.longitude) as unknown as string,
      radiusM: input.radiusM,
      photoEnabled: input.photoEnabled,
      tags: input.tags,
      stayMinutes: input.stayMinutes,
      draft: input.content as PlaceContent,
    })
    .onConflictDoNothing()
    .returning({ id: places.id });
  if (!row) throw new AppError("QUEST_RUN_CONFLICT", "slug 已存在");
  await audit({ actorType: "admin", actorId: admin.id, action: "place.create", targetType: "place", targetId: row.id });
  return row;
}

export async function adminPatchPlace(admin: AdminPrincipal, placeId: string, input: z.infer<typeof placePatchSchema>) {
  const [current] = await db().select().from(places).where(eq(places.id, placeId));
  if (!current) throw new AppError("NOT_FOUND", "地点不存在");
  if (input.status === "published" && !current.publishedVersionId) {
    throw new AppError("VALIDATION_ERROR", "请先发布地点版本");
  }
  const set: Partial<typeof places.$inferInsert> = { updatedAt: new Date() };
  if (input.nameZh) set.nameZh = input.nameZh;
  if (input.nameJa) set.nameJa = input.nameJa;
  if (input.nameEn !== undefined) set.nameEn = input.nameEn;
  if (input.latitude !== undefined && input.longitude !== undefined) set.geo = point(input.latitude, input.longitude) as unknown as string;
  if (input.radiusM !== undefined) set.radiusM = input.radiusM;
  if (input.photoEnabled !== undefined) set.photoEnabled = input.photoEnabled;
  if (input.tags) set.tags = input.tags;
  if (input.stayMinutes !== undefined) set.stayMinutes = input.stayMinutes;
  if (input.content) set.draft = input.content as PlaceContent;
  if (input.status) set.status = input.status;
  await db().update(places).set(set).where(eq(places.id, placeId));
  const affectedRuns = input.status && input.status !== "published" ? await activeRunsUsingPlace(placeId) : 0;
  await audit({
    actorType: "admin",
    actorId: admin.id,
    action: input.status ? `place.status.${input.status}` : "place.update",
    targetType: "place",
    targetId: placeId,
    meta: { fields: Object.keys(input), affectedActiveRuns: affectedRuns },
  });
  return { placeId, affectedActiveRuns: affectedRuns };
}

export async function adminPublishPlace(admin: AdminPrincipal, placeId: string) {
  const result = await publishPlace(placeId, admin.id);
  await audit({ actorType: "admin", actorId: admin.id, action: "place.publish", targetType: "place", targetId: placeId, meta: result });
  return result;
}

export const referenceUploadSchema = z.object({
  viewNote: z.string().min(2).max(300),
  /** Null for photos the project took itself (field survey); the author and usage basis then say so. */
  sourceUrl: z.url().nullable(),
  author: z.string().min(1).max(120),
  license: z.string().min(2).max(60),
  usageBasis: z.string().min(4).max(300),
  publicDisplay: z.boolean(),
  capturedOn: z.string().max(40).nullable(),
  aiGenerated: z.literal(false, { message: "AI 生成图片不能作为地点核验参考图" }),
});

export async function adminAddReference(admin: AdminPrincipal, placeId: string, bytes: Buffer, meta: z.infer<typeof referenceUploadSchema>) {
  const ref = await addReferenceImage(placeId, { bytes, ...meta });
  await audit({ actorType: "admin", actorId: admin.id, action: "reference.add", targetType: "place", targetId: placeId, meta: { referenceId: ref.id, license: meta.license } });
  return { referenceId: ref.id, note: "新参考图会在下次发布地点版本后用于核验" };
}

export async function adminRetireReference(admin: AdminPrincipal, refId: string) {
  const [ref] = await db().update(referenceImages).set({ status: "retired" }).where(eq(referenceImages.id, refId)).returning({ placeId: referenceImages.placeId });
  if (!ref) throw new AppError("NOT_FOUND", "参考图不存在");
  await audit({ actorType: "admin", actorId: admin.id, action: "reference.retire", targetType: "place", targetId: ref.placeId, meta: { referenceId: refId } });
  return { retired: true };
}

export async function adminPlaceDetail(placeId: string) {
  const [place] = await db().select().from(places).where(eq(places.id, placeId));
  if (!place) throw new AppError("NOT_FOUND", "地点不存在");
  const refs = await db()
    .select()
    .from(referenceImages)
    .where(eq(referenceImages.placeId, placeId))
    .orderBy(asc(referenceImages.createdAt));
  const versions = await db()
    .select({ id: placeVersions.id, version: placeVersions.version, publishedAt: placeVersions.publishedAt, photoEnabled: placeVersions.photoEnabled, referenceVersion: placeVersions.referenceVersion })
    .from(placeVersions)
    .where(eq(placeVersions.placeId, placeId))
    .orderBy(desc(placeVersions.version));
  const [coords] = await db()
    .select({ latitude: sql<number>`ST_Y(${places.geo}::geometry)`.mapWith(Number), longitude: sql<number>`ST_X(${places.geo}::geometry)`.mapWith(Number) })
    .from(places)
    .where(eq(places.id, placeId));
  return { place: { ...place, geo: undefined, ...coords }, references: refs.map((r) => ({ ...r, imageUrl: `/api/v1/admin/references/${r.id}/image` })), versions };
}

// ── Quests ──────────────────────────────────────────────────────────────────

export async function adminListQuests() {
  const rows = await db()
    .select({
      id: quests.id,
      slug: quests.slug,
      status: quests.status,
      publishedVersionId: quests.publishedVersionId,
    })
    .from(quests)
    .orderBy(asc(quests.slug));
  const versions = await db()
    .select({ id: questVersions.id, questId: questVersions.questId, version: questVersions.version, title: questVersions.title, publishedAt: questVersions.publishedAt })
    .from(questVersions)
    .orderBy(desc(questVersions.version));
  return rows.map((q) => ({ ...q, versions: versions.filter((v) => v.questId === q.id) }));
}

export async function adminQuestVersion(versionId: string) {
  const [v] = await db().select().from(questVersions).where(eq(questVersions.id, versionId));
  if (!v) throw new AppError("NOT_FOUND", "故事版本不存在");
  const steps = await db()
    .select({ step: questSteps, placeSlug: places.slug })
    .from(questSteps)
    .innerJoin(places, eq(places.id, questSteps.placeId))
    .where(eq(questSteps.questVersionId, versionId))
    .orderBy(asc(questSteps.position));
  return { version: v, steps: steps.map((s) => ({ ...s.step, placeSlug: s.placeSlug })) };
}

export const questVersionSchema = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(80),
  intro: z.string().min(10).max(1200),
  ending: z.string().min(10).max(1200),
  estimatedMinutes: z.number().int().min(10).max(300),
  fictionNote: z.string().min(5).max(300),
  steps: z
    .array(
      z.object({
        placeSlug: z.string(),
        proofPolicy: z.enum(PROOF_POLICIES),
        required: z.boolean().default(true),
        title: z.string().min(1).max(60),
        story: z.string().min(1).max(800),
        objective: z.string().min(1).max(300),
        clue: z.string().min(1).max(300),
        observationQuestion: z.string().min(1).max(300),
        completionText: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(12),
});

export async function adminCreateQuestVersion(admin: AdminPrincipal, questId: string, input: z.infer<typeof questVersionSchema>) {
  const slugs = [...new Set(input.steps.map((s) => s.placeSlug))];
  const rows = await db().select({ id: places.id, slug: places.slug }).from(places).where(inArray(places.slug, slugs));
  const map = new Map(rows.map((r) => [r.slug, r.id]));
  const missing = slugs.filter((s) => !map.has(s));
  if (missing.length) throw new AppError("VALIDATION_ERROR", `未知地点：${missing.join("、")}`);
  const v = await createQuestVersion(questId, { ...input, steps: input.steps.map((s) => ({ ...s, placeId: map.get(s.placeSlug)! })) });
  await audit({ actorType: "admin", actorId: admin.id, action: "quest.version.create", targetType: "quest", targetId: questId, meta: { version: v.version } });
  return { versionId: v.id, version: v.version };
}

export async function adminPublishQuestVersion(admin: AdminPrincipal, versionId: string) {
  const r = await publishQuestVersion(versionId);
  await audit({ actorType: "admin", actorId: admin.id, action: "quest.publish", targetType: "quest", targetId: r.questId, meta: { version: r.version } });
  return r;
}

// ── Operations ──────────────────────────────────────────────────────────────

export async function adminAiCalls(opts: { onlyFailed: boolean; sinceHours: number }) {
  const since = new Date(Date.now() - opts.sinceHours * 3_600_000);
  const rows = await db()
    .select()
    .from(aiCalls)
    .where(and(gte(aiCalls.createdAt, since), opts.onlyFailed ? eq(aiCalls.status, "failed") : undefined))
    .orderBy(desc(aiCalls.createdAt))
    .limit(200);
  const [summary] = await db()
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${aiCalls.status} = 'failed')`.mapWith(Number),
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${aiCalls.latencyMs})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${aiCalls.latencyMs})`,
      cost: sql<number | null>`sum(${aiCalls.estimatedCostUsd})`,
    })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, since));
  const failedAttempts = await db()
    .select({ id: photoAttempts.id, errorCode: photoAttempts.errorCode, errorStage: photoAttempts.errorStage, updatedAt: photoAttempts.updatedAt })
    .from(photoAttempts)
    .where(and(eq(photoAttempts.processingStatus, "failed"), gte(photoAttempts.updatedAt, since)))
    .orderBy(desc(photoAttempts.updatedAt))
    .limit(100);
  return { summary, calls: rows, failedAttempts };
}

export async function adminAuditLog(limit = 200) {
  return db().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(Math.min(limit, 500));
}
