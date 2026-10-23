import { and, desc, eq, sql } from "drizzle-orm";
import { capabilities, env } from "../config/env";
import { db } from "../db/client";
import {
  assets,
  checkins,
  photoAttempts,
  photoEvaluations,
  photoRatings,
  places,
  placeVerifications,
  placeVersions,
  reviewRequests,
  type LocationEvidence,
} from "../db/schema";
import type { PositionInput } from "../contracts/api";
import { demoSamplesFor } from "../demo/samples";
import { RUBRIC_VERSION, GRADE_MEANINGS, type Grade } from "../domain/grading";
import { describeAttempt, retryableStage, type Mode } from "../domain/status";
import { AppError } from "../http/errors";
import { enforceRateLimit } from "../infra/rate-limit";
import { enqueueInTx } from "../queue/outbox";
import { evaluatePosition } from "./checkins";
import { loadOwnReadyAsset } from "./photos";
import { loadCheckinPlace } from "./places";
import { validateQuestContext, type QuestContext } from "./rewards";
import { attemptDedupeKey, contextKey, currentAiVersions, evaluationCacheKey } from "./versions";

// Photo attempts (spec §6, §9). Creating one returns immediately (202); the
// worker performs verification and rating. Read models expose the three
// status axes separately.

export function verifyJobId(attemptId: string, retryCount: number) {
  return `${attemptId}:verify:${retryCount}`;
}
export function rateJobId(attemptId: string, retryCount: number) {
  return `${attemptId}:rate:${retryCount}`;
}

interface CreateResult {
  attemptId: string;
  created: boolean;
}

async function loadPhotoPlace(tx: Parameters<typeof loadCheckinPlace>[0], placeId: string) {
  const place = await loadCheckinPlace(tx, placeId);
  const [version] = await tx.select().from(placeVersions).where(eq(placeVersions.id, place.versionId)).limit(1);
  if (!place.photoEnabled || !version?.photoEnabled || version.referenceImageIds.length < 3) {
    throw new AppError("PHOTO_CHECKIN_UNAVAILABLE", "这个地点暂不支持照片核验，请使用定位打卡");
  }
  return { place, version };
}

export async function createPhotoAttempt(
  opts: {
    visitorId: string;
    placeId: string;
    assetId: string;
    position: PositionInput | null;
    clientIp: string | null;
  } & QuestContext,
): Promise<CreateResult> {
  const versions = currentAiVersions("live");
  if (!versions) {
    throw new AppError("AI_NOT_CONFIGURED", "照片核验服务暂未开通，你可以先使用定位打卡或在线试玩", {
      missing: capabilities().ai.missing,
    });
  }
  const asset = await loadOwnReadyAsset(opts.visitorId, opts.assetId);

  return db().transaction(async (tx) => {
    const { place, version } = await loadPhotoPlace(tx, opts.placeId);
    await validateQuestContext(tx, { ...opts, mode: "live", method: "photo" });

    const evalKey = evaluationCacheKey({
      visitorId: opts.visitorId,
      mode: "live",
      placeVersionId: version.id,
      referenceVersion: version.referenceVersion,
      imageSha256: asset.sha256,
      versions,
    });
    const ctxKey = contextKey(opts.questRunId, opts.questStepId);
    const dedupeKey = attemptDedupeKey(evalKey, ctxKey);

    const [existing] = await tx
      .select({ id: photoAttempts.id })
      .from(photoAttempts)
      .where(eq(photoAttempts.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) return { attemptId: existing.id, created: false };

    // Rate-limit only new work; returning an existing attempt is free.
    const e = env();
    await enforceRateLimit({
      bucket: "photo-attempt",
      subject: opts.visitorId,
      limit: e.PHOTO_ATTEMPTS_PER_HOUR,
      windowSeconds: 3600,
      message: `每小时最多提交 ${e.PHOTO_ATTEMPTS_PER_HOUR} 次照片核验，请稍后再试`,
    });
    if (opts.clientIp) {
      await enforceRateLimit({
        bucket: "photo-attempt-ip",
        subject: opts.clientIp,
        limit: e.PHOTO_ATTEMPTS_PER_IP_PER_HOUR,
        windowSeconds: 3600,
      });
    }

    let locationEvidence: LocationEvidence | null = null;
    if (opts.position) {
      const verdict = evaluatePosition(opts.position, place);
      locationEvidence = {
        verdict: verdict.code,
        distanceMeters: verdict.distanceMeters,
        accuracyMeters: opts.position.accuracyMeters,
        arrivalVerified: verdict.ok,
        simulated: false,
      };
    }

    await tx
      .insert(photoEvaluations)
      .values({
        visitorId: opts.visitorId,
        mode: "live",
        placeVersionId: version.id,
        imageSha256: asset.sha256,
        provider: versions.provider,
        model: versions.model,
        modelConfigVersion: versions.modelConfigVersion,
        verifyPromptVersion: versions.verifyPromptVersion,
        ratingPromptVersion: versions.ratingPromptVersion,
        rubricVersion: RUBRIC_VERSION,
        referenceVersion: version.referenceVersion,
        cacheKey: evalKey,
      })
      .onConflictDoNothing();
    const [evaluation] = await tx
      .select({ id: photoEvaluations.id })
      .from(photoEvaluations)
      .where(eq(photoEvaluations.cacheKey, evalKey));

    const inserted = await tx
      .insert(photoAttempts)
      .values({
        visitorId: opts.visitorId,
        mode: "live",
        placeId: place.id,
        placeVersionId: version.id,
        assetId: asset.id,
        evaluationId: evaluation!.id,
        contextKey: ctxKey,
        dedupeKey,
        questRunId: opts.questRunId,
        questStepId: opts.questStepId,
        locationEvidence,
      })
      .onConflictDoNothing()
      .returning({ id: photoAttempts.id });

    if (inserted.length === 0) {
      // Lost a race with an identical concurrent submission.
      const [winner] = await tx.select({ id: photoAttempts.id }).from(photoAttempts).where(eq(photoAttempts.dedupeKey, dedupeKey));
      return { attemptId: winner!.id, created: false };
    }
    const attemptId = inserted[0]!.id;
    await enqueueInTx(tx, "attempt.verify", attemptId, verifyJobId(attemptId, 0));
    return { attemptId, created: true };
  });
}

/** Demo attempt from a fixed labelled sample. Isolated by mode = demo. */
export async function createDemoAttempt(
  opts: { visitorId: string; placeId: string; sampleKey: string } & QuestContext,
): Promise<CreateResult> {
  if (!capabilities().demo) throw new AppError("DEMO_DISABLED", "在线试玩未开启");
  return db().transaction(async (tx) => {
    const { place, version } = await loadPhotoPlace(tx, opts.placeId);
    const sample = demoSamplesFor(place.slug, version.content.distinctiveFeatures[0] ?? "地标").find(
      (s) => s.key === opts.sampleKey,
    );
    if (!sample) throw new AppError("NOT_FOUND", "没有这个试玩样例");
    const [asset] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.objectKey, sample.objectKey), eq(assets.kind, "sample")))
      .limit(1);
    if (!asset) throw new AppError("NOT_FOUND", "试玩样例图片尚未准备好");
    await validateQuestContext(tx, { ...opts, mode: "demo", method: "photo" });

    const versions = currentAiVersions("demo")!;
    const evalKey = evaluationCacheKey({
      visitorId: opts.visitorId,
      mode: "demo",
      placeVersionId: version.id,
      referenceVersion: version.referenceVersion,
      imageSha256: asset.sha256,
      versions,
    });
    const ctxKey = contextKey(opts.questRunId, opts.questStepId);
    const dedupeKey = attemptDedupeKey(evalKey, ctxKey);
    const [existing] = await tx.select({ id: photoAttempts.id }).from(photoAttempts).where(eq(photoAttempts.dedupeKey, dedupeKey));
    if (existing) return { attemptId: existing.id, created: false };

    await tx
      .insert(photoEvaluations)
      .values({
        visitorId: opts.visitorId,
        mode: "demo",
        placeVersionId: version.id,
        imageSha256: asset.sha256,
        provider: versions.provider,
        model: versions.model,
        modelConfigVersion: versions.modelConfigVersion,
        verifyPromptVersion: versions.verifyPromptVersion,
        ratingPromptVersion: versions.ratingPromptVersion,
        rubricVersion: RUBRIC_VERSION,
        referenceVersion: version.referenceVersion,
        cacheKey: evalKey,
      })
      .onConflictDoNothing();
    const [evaluation] = await tx.select({ id: photoEvaluations.id }).from(photoEvaluations).where(eq(photoEvaluations.cacheKey, evalKey));
    const [attempt] = await tx
      .insert(photoAttempts)
      .values({
        visitorId: opts.visitorId,
        mode: "demo",
        placeId: place.id,
        placeVersionId: version.id,
        assetId: asset.id,
        evaluationId: evaluation!.id,
        contextKey: ctxKey,
        dedupeKey,
        questRunId: opts.questRunId,
        questStepId: opts.questStepId,
        sampleKey: sample.key,
      })
      .returning({ id: photoAttempts.id });
    await enqueueInTx(tx, "attempt.verify", attempt!.id, verifyJobId(attempt!.id, 0));
    return { attemptId: attempt!.id, created: true };
  });
}

export interface AttemptView {
  attemptId: string;
  mode: Mode;
  processingStatus: string;
  stageLabel: string;
  place: { id: string; slug: string; nameZh: string; nameJa: string };
  photo: { assetId: string; previewUrl: string | null; sampleLabel: string | null };
  quest: { runId: string; stepId: string } | null;
  verification: {
    status: string;
    source: string | null;
    message: string | null;
    reasonCode: string | null;
    evidence: unknown[];
    reshootSuggestion: string | null;
  };
  checkin: { id: string; method: "photo"; arrivalVerified: boolean; label: string } | null;
  rating: {
    status: string;
    dimensions: { composition: number; lighting: number; clarity: number; expression: number } | null;
    total: number | null;
    grade: Grade | null;
    gradeMeaning: string | null;
    strength: string | null;
    improvement: string | null;
    rubricVersion: string | null;
    unscorableReason: string | null;
  };
  error: { code: string; stage: string | null; retryable: boolean } | null;
  review: { status: string; reason: string | null } | null;
  canRetry: "verify" | "rate" | null;
  canRequestReview: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAttemptView(opts: { visitorId: string; attemptId: string }): Promise<AttemptView> {
  const [row] = await db()
    .select({
      a: photoAttempts,
      placeSlug: places.slug,
      placeNameZh: places.nameZh,
      placeNameJa: places.nameJa,
      evaluationRating: photoEvaluations.rating,
      assetKind: assets.kind,
      assetState: assets.state,
    })
    .from(photoAttempts)
    .innerJoin(places, eq(places.id, photoAttempts.placeId))
    .innerJoin(photoEvaluations, eq(photoEvaluations.id, photoAttempts.evaluationId))
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .where(and(eq(photoAttempts.id, opts.attemptId), eq(photoAttempts.visitorId, opts.visitorId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "没有找到这次照片打卡");
  const a = row.a;

  const [verification] = await db()
    .select()
    .from(placeVerifications)
    .where(eq(placeVerifications.attemptId, a.id))
    .orderBy(desc(placeVerifications.createdAt))
    .limit(1);
  const [rating] = await db().select().from(photoRatings).where(eq(photoRatings.attemptId, a.id)).limit(1);
  const [checkin] = await db().select().from(checkins).where(eq(checkins.attemptId, a.id)).limit(1);
  const [review] = await db()
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.attemptId, a.id))
    .orderBy(desc(reviewRequests.createdAt))
    .limit(1);

  const unscorableReason =
    a.ratingStatus === "unscorable"
      ? ((row.evaluationRating as { unscorableReason?: string } | null)?.unscorableReason ?? null)
      : null;
  const sampleLabel = a.sampleKey ? (a.sampleKey.endsWith("--match") ? "样例 A" : a.sampleKey.endsWith("--unclear") ? "样例 B" : "样例 C") : null;
  const loc = a.locationEvidence;
  const checkinLabel =
    a.mode === "demo"
      ? "试玩打卡 · 样例照片"
      : loc?.arrivalVerified
        ? "照片匹配 · 位置符合范围"
        : "照片地点匹配 · 未核验到访";

  return {
    attemptId: a.id,
    mode: a.mode,
    processingStatus: a.processingStatus,
    stageLabel: describeAttempt(a),
    place: { id: a.placeId, slug: row.placeSlug, nameZh: row.placeNameZh, nameJa: row.placeNameJa },
    photo: {
      assetId: a.assetId,
      previewUrl:
        row.assetState !== "ready"
          ? null
          : row.assetKind === "sample"
            ? `/api/v1/demo/samples/${encodeURIComponent(a.sampleKey ?? "")}/image`
            : `/api/v1/photos/${a.assetId}/thumb`,
      sampleLabel,
    },
    quest: a.questRunId && a.questStepId ? { runId: a.questRunId, stepId: a.questStepId } : null,
    verification: {
      status: a.verificationStatus,
      source: verification?.source ?? null,
      message: verification?.userMessage ?? null,
      reasonCode: verification?.reasonCode ?? null,
      evidence: verification?.evidence ?? [],
      reshootSuggestion: verification?.reshootSuggestion ?? null,
    },
    checkin: checkin ? { id: checkin.id, method: "photo", arrivalVerified: checkin.arrivalVerified, label: checkinLabel } : null,
    rating: {
      status: a.ratingStatus,
      dimensions: rating
        ? { composition: rating.composition, lighting: rating.lighting, clarity: rating.clarity, expression: rating.expression }
        : null,
      total: rating?.total ?? null,
      grade: (rating?.grade as Grade | undefined) ?? null,
      gradeMeaning: rating ? GRADE_MEANINGS[rating.grade as Grade] : null,
      strength: rating?.strength ?? null,
      improvement: rating?.improvement ?? null,
      rubricVersion: rating?.rubricVersion ?? null,
      unscorableReason,
    },
    error: a.errorCode ? { code: a.errorCode, stage: a.errorStage, retryable: retryableStage(a) !== null } : null,
    review: review ? { status: review.status, reason: review.reason } : null,
    canRetry: retryableStage(a),
    canRequestReview: a.mode === "live" && a.verificationStatus === "uncertain" && !review,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function retryAttempt(opts: { visitorId: string; attemptId: string }): Promise<{ attemptId: string; stage: "verify" | "rate" }> {
  return db().transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(photoAttempts)
      .where(and(eq(photoAttempts.id, opts.attemptId), eq(photoAttempts.visitorId, opts.visitorId)))
      .for("update");
    if (!a) throw new AppError("NOT_FOUND", "没有找到这次照片打卡");
    if (a.cancelledAt) throw new AppError("ATTEMPT_NOT_RETRYABLE", "这次照片打卡已取消");
    const stage = retryableStage(a);
    if (!stage) throw new AppError("ATTEMPT_NOT_RETRYABLE", "这次照片打卡当前不需要重试");
    if (stage === "verify" && a.mode === "live" && !currentAiVersions("live")) {
      throw new AppError("AI_NOT_CONFIGURED", "照片核验服务暂未开通");
    }
    const retryCount = a.retryCount + 1;
    await tx
      .update(photoAttempts)
      .set({
        retryCount,
        processingStatus: "queued",
        errorCode: null,
        errorStage: null,
        ...(stage === "verify" ? { verificationStatus: "pending" as const } : { ratingStatus: "pending" as const }),
        updatedAt: new Date(),
      })
      .where(eq(photoAttempts.id, a.id));
    if (stage === "verify") {
      await enqueueInTx(tx, "attempt.verify", a.id, verifyJobId(a.id, retryCount));
    } else {
      await enqueueInTx(tx, "attempt.rate", a.id, rateJobId(a.id, retryCount));
    }
    return { attemptId: a.id, stage };
  });
}

export async function requestReview(opts: { visitorId: string; attemptId: string; note?: string }) {
  return db().transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(photoAttempts)
      .where(and(eq(photoAttempts.id, opts.attemptId), eq(photoAttempts.visitorId, opts.visitorId)))
      .for("update");
    if (!a) throw new AppError("NOT_FOUND", "没有找到这次照片打卡");
    if (a.mode !== "live") throw new AppError("REVIEW_NOT_ALLOWED", "试玩记录不支持人工复核");
    if (a.cancelledAt) throw new AppError("DATA_DELETION_IN_PROGRESS", "这张照片正在删除");
    if (a.verificationStatus !== "uncertain") {
      throw new AppError("REVIEW_NOT_ALLOWED", "只有“无法确认”的结果可以申请人工复核");
    }
    const [prior] = await tx
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(eq(reviewRequests.attemptId, a.id))
      .limit(1);
    if (prior) throw new AppError("REVIEW_ALREADY_REQUESTED", "这次照片打卡已经申请过人工复核");
    const [review] = await tx
      .insert(reviewRequests)
      .values({ attemptId: a.id, note: opts.note ?? null })
      .returning({ id: reviewRequests.id });
    return { reviewRequestId: review!.id };
  });
}

/** Recent attempts for "我的东京" and resuming after a page refresh. */
export async function listRecentAttempts(opts: { visitorId: string; mode: Mode; limit?: number }) {
  return db()
    .select({
      id: photoAttempts.id,
      placeId: photoAttempts.placeId,
      processingStatus: photoAttempts.processingStatus,
      verificationStatus: photoAttempts.verificationStatus,
      ratingStatus: photoAttempts.ratingStatus,
      createdAt: photoAttempts.createdAt,
    })
    .from(photoAttempts)
    .where(and(eq(photoAttempts.visitorId, opts.visitorId), eq(photoAttempts.mode, opts.mode), sql`${photoAttempts.cancelledAt} is null`))
    .orderBy(desc(photoAttempts.createdAt))
    .limit(Math.min(opts.limit ?? 20, 50));
}
