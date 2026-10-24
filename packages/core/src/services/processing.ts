import { and, eq, inArray, sql } from "drizzle-orm";
import { createVisionProvider, AiError, type VisionProvider } from "../ai";
import type { FakeFaults } from "../ai/fake";
import type { VisionImage } from "../ai/types";
import {
  photoRatingOutputSchema,
  placeVerificationOutputSchema,
  type PhotoRatingOutput,
  type PlaceVerificationOutput,
} from "../contracts/ai";
import { db, type Tx } from "../db/client";
import {
  aiCalls,
  assets,
  checkins,
  photoAttempts,
  photoEvaluations,
  photoRatings,
  placeProgress,
  places,
  placeVerifications,
  placeVersions,
  referenceImages,
} from "../db/schema";
import { demoSamplesFor } from "../demo/samples";
import { ratePhoto, RUBRIC_VERSION } from "../domain/grading";
import { enqueueInTx } from "../queue/outbox";
import { modelKeyFor } from "../storage/images";
import { getObject } from "../storage/s3";
import { rateJobId } from "./attempts";
import { applyCheckinEffects } from "./rewards";

// Worker-side processing of photo attempts (spec §9.3). Each stage:
//  1. reads fresh state and exits if already done or cancelled,
//  2. reuses a cached evaluation or calls the provider (no DB lock held),
//  3. commits the outcome in one transaction guarded by status checks.
// Technical errors propagate so BullMQ can retry; the final failure is
// recorded by markStageFailed.

export type Stage = "verify" | "rate";

export class StageAborted extends Error {}

interface ProcessorDeps {
  provider?: () => VisionProvider | Promise<VisionProvider>;
  faults?: FakeFaults;
}

async function loadAttempt(attemptId: string) {
  const [row] = await db()
    .select({ a: photoAttempts, e: photoEvaluations })
    .from(photoAttempts)
    .innerJoin(photoEvaluations, eq(photoEvaluations.id, photoAttempts.evaluationId))
    .where(eq(photoAttempts.id, attemptId))
    .limit(1);
  return row ?? null;
}

async function isCancelled(attemptId: string): Promise<boolean> {
  const [row] = await db()
    .select({ cancelledAt: photoAttempts.cancelledAt, state: assets.state })
    .from(photoAttempts)
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .where(eq(photoAttempts.id, attemptId));
  return !row || row.cancelledAt !== null || row.state !== "ready";
}

async function imageFromKey(key: string, role: VisionImage["role"], note?: string): Promise<VisionImage> {
  return { role, mediaType: "image/jpeg", data: await getObject(key), note };
}

async function recordCall(values: typeof aiCalls.$inferInsert) {
  await db().insert(aiCalls).values(values);
}

async function setRunning(attemptId: string) {
  await db()
    .update(photoAttempts)
    .set({ processingStatus: "running", updatedAt: new Date() })
    .where(and(eq(photoAttempts.id, attemptId), inArray(photoAttempts.processingStatus, ["queued", "running"])));
}

// ── Verification ────────────────────────────────────────────────────────────

async function obtainVerification(
  row: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>,
  deps: ProcessorDeps,
  queueWaitMs: number | null,
): Promise<{ output: PlaceVerificationOutput; source: "ai" | "demo_sample" }> {
  const { a, e } = row;

  if (a.mode === "demo") {
    const [place] = await db().select().from(places).where(eq(places.id, a.placeId));
    const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, a.placeVersionId));
    const sample = demoSamplesFor(place!.slug, version!.content.distinctiveFeatures[0] ?? "地标").find(
      (s) => s.key === a.sampleKey,
    );
    if (!sample) throw new AiError("AI_BAD_REQUEST", "试玩样例不存在");
    return { output: sample.verification, source: "demo_sample" };
  }

  // Cached result for this visitor + image + versions (spec §6.9).
  if (e.verification && ["matched", "uncertain", "mismatched"].includes(e.verificationStatus)) {
    return { output: placeVerificationOutputSchema.parse(e.verification), source: "ai" };
  }

  const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, a.placeVersionId));
  const [asset] = await db().select().from(assets).where(eq(assets.id, a.assetId));
  const refs = version!.referenceImageIds.length
    ? await db()
        .select({ viewNote: referenceImages.viewNote, objectKey: assets.objectKey })
        .from(referenceImages)
        .innerJoin(assets, eq(assets.id, referenceImages.assetId))
        .where(inArray(referenceImages.id, version!.referenceImageIds))
    : [];
  if (refs.length === 0) throw new AiError("AI_BAD_REQUEST", "地点缺少参考图，无法核验");

  const provider = await (deps.provider ?? (() => createVisionProvider(deps.faults)))();
  const started = Date.now();
  try {
    if (await isCancelled(a.id)) throw new StageAborted();
    const userPhoto = await imageFromKey(modelKeyFor(asset!.objectKey), "user");
    const references = await Promise.all(refs.map((r) => imageFromKey(modelKeyFor(r.objectKey), "reference", r.viewNote)));
    const call = await provider.verifyPlace({
      target: {
        nameZh: version!.nameZh,
        nameJa: version!.nameJa,
        distinctiveFeatures: version!.content.distinctiveFeatures,
        confusablePlaces: version!.content.confusablePlaces,
        unsuitableAngles: version!.content.unsuitableAngles,
        referenceVersion: version!.referenceVersion,
      },
      userPhoto,
      references,
    });
    await recordCall({
      attemptId: a.id,
      evaluationId: e.id,
      stage: "verify",
      provider: provider.name,
      model: call.model,
      modelConfigVersion: e.modelConfigVersion,
      promptVersion: e.verifyPromptVersion,
      referenceVersion: e.referenceVersion,
      status: "succeeded",
      latencyMs: call.latencyMs,
      queueWaitMs,
      usage: { ...(call.usage ?? {}), requests: call.requests },
    });
    // First writer wins; a concurrent duplicate call cannot overwrite the cached verdict.
    await db()
      .update(photoEvaluations)
      .set({ verificationStatus: call.output.verdict, verification: call.output, updatedAt: new Date() })
      .where(and(eq(photoEvaluations.id, e.id), eq(photoEvaluations.verificationStatus, "pending")));
    const [fresh] = await db().select().from(photoEvaluations).where(eq(photoEvaluations.id, e.id));
    return { output: placeVerificationOutputSchema.parse(fresh!.verification), source: "ai" };
  } catch (error) {
    if (error instanceof AiError) {
      await recordCall({
        attemptId: a.id,
        evaluationId: e.id,
        stage: "verify",
        provider: provider.name,
        model: provider.model,
        modelConfigVersion: e.modelConfigVersion,
        promptVersion: e.verifyPromptVersion,
        referenceVersion: e.referenceVersion,
        status: "failed",
        errorCode: error.code,
        errorDetail: error.message.slice(0, 300),
        latencyMs: error.latencyMs ?? Date.now() - started,
        queueWaitMs,
      });
    }
    throw error;
  }
}

export async function processVerify(attemptId: string, deps: ProcessorDeps = {}, queueWaitMs: number | null = null) {
  const row = await loadAttempt(attemptId);
  if (!row) return { skipped: "missing" as const };
  if (row.a.verificationStatus !== "pending" && row.a.verificationStatus !== "error") return { skipped: "done" as const };
  if (await isCancelled(attemptId)) return { skipped: "cancelled" as const };
  await setRunning(attemptId);

  let result: Awaited<ReturnType<typeof obtainVerification>>;
  try {
    result = await obtainVerification(row, deps, queueWaitMs);
  } catch (error) {
    if (error instanceof StageAborted) return { skipped: "cancelled" as const };
    throw error;
  }

  return db().transaction(async (tx) => {
    const [a] = await tx.select().from(photoAttempts).where(eq(photoAttempts.id, attemptId)).for("update");
    if (!a || a.verificationStatus !== "pending" || a.cancelledAt) return { skipped: "done" as const };
    const [asset] = await tx.select({ state: assets.state }).from(assets).where(eq(assets.id, a.assetId));
    if (asset?.state !== "ready") return { skipped: "cancelled" as const };

    const v = result.output;
    await tx.insert(placeVerifications).values({
      attemptId,
      source: result.source,
      verdict: v.verdict,
      reasonCode: v.reasonCode,
      evidence: v.evidence,
      userMessage: v.userMessage,
      reshootSuggestion: v.reshootSuggestion,
    });

    if (v.verdict !== "matched") {
      await tx
        .update(photoAttempts)
        .set({ verificationStatus: v.verdict, processingStatus: "succeeded", ratingStatus: "not_requested", updatedAt: new Date() })
        .where(eq(photoAttempts.id, attemptId));
      return { verdict: v.verdict };
    }
    return acceptMatchedAttempt(tx, a);
  });
}

/**
 * Shared by AI matches and approved human reviews: create the photo check-in,
 * apply rewards, then queue rating — all in the caller's transaction.
 */
export async function acceptMatchedAttempt(tx: Tx, a: typeof photoAttempts.$inferSelect) {
  // Re-check the place: no new rewards for a place closed mid-processing (spec §9.3 item 13).
  const [place] = await tx.select({ status: places.status }).from(places).where(eq(places.id, a.placeId));
  if (place?.status !== "published") {
    await tx
      .update(photoAttempts)
      .set({
        verificationStatus: "matched",
        processingStatus: "failed",
        errorCode: "PLACE_UNAVAILABLE",
        errorStage: "verify",
        updatedAt: new Date(),
      })
      .where(eq(photoAttempts.id, a.id));
    return { verdict: "matched" as const, placeUnavailable: true };
  }

  const loc = a.locationEvidence;
  const inserted = await tx
    .insert(checkins)
    .values({
      visitorId: a.visitorId,
      mode: a.mode,
      placeId: a.placeId,
      method: "photo",
      attemptId: a.id,
      arrivalVerified: Boolean(loc?.arrivalVerified),
      distanceMeters: loc?.distanceMeters ?? null,
      accuracyMeters: loc?.accuracyMeters ?? null,
      questRunId: a.questRunId,
      questStepId: a.questStepId,
    })
    .onConflictDoNothing()
    .returning({ id: checkins.id });

  let effects = null;
  if (inserted.length > 0) {
    effects = await applyCheckinEffects(tx, {
      visitorId: a.visitorId,
      mode: a.mode,
      placeId: a.placeId,
      checkinId: inserted[0]!.id,
      method: "photo",
      questRunId: a.questRunId,
      questStepId: a.questStepId,
    });
  }
  await tx
    .update(photoAttempts)
    .set({ verificationStatus: "matched", ratingStatus: "pending", processingStatus: "running", updatedAt: new Date() })
    .where(eq(photoAttempts.id, a.id));
  await enqueueInTx(tx, "attempt.rate", a.id, rateJobId(a.id, a.retryCount));
  return { verdict: "matched" as const, effects };
}

// ── Rating ──────────────────────────────────────────────────────────────────

async function obtainRating(
  row: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>,
  deps: ProcessorDeps,
  queueWaitMs: number | null,
): Promise<PhotoRatingOutput> {
  const { a, e } = row;
  if (a.mode === "demo") {
    const [place] = await db().select().from(places).where(eq(places.id, a.placeId));
    const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, a.placeVersionId));
    const sample = demoSamplesFor(place!.slug, version!.content.distinctiveFeatures[0] ?? "地标").find(
      (s) => s.key === a.sampleKey,
    );
    if (!sample?.rating) throw new AiError("AI_BAD_REQUEST", "试玩样例没有评分");
    return sample.rating;
  }
  if (e.rating && (e.ratingStatus === "completed" || e.ratingStatus === "unscorable")) {
    return photoRatingOutputSchema.parse(e.rating);
  }

  const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, a.placeVersionId));
  const [asset] = await db().select().from(assets).where(eq(assets.id, a.assetId));
  const provider = await (deps.provider ?? (() => createVisionProvider(deps.faults)))();
  const started = Date.now();
  try {
    if (await isCancelled(a.id)) throw new StageAborted();
    const call = await provider.ratePhoto({
      placeNameZh: version!.nameZh,
      placeNameJa: version!.nameJa,
      userPhoto: await imageFromKey(modelKeyFor(asset!.objectKey), "user"),
    });
    await recordCall({
      attemptId: a.id,
      evaluationId: e.id,
      stage: "rate",
      provider: provider.name,
      model: call.model,
      modelConfigVersion: e.modelConfigVersion,
      promptVersion: e.ratingPromptVersion,
      status: "succeeded",
      latencyMs: call.latencyMs,
      queueWaitMs,
      usage: { ...(call.usage ?? {}), requests: call.requests },
    });
    await db()
      .update(photoEvaluations)
      .set({
        ratingStatus: call.output.scorable ? "completed" : "unscorable",
        rating: call.output,
        updatedAt: new Date(),
      })
      .where(and(eq(photoEvaluations.id, e.id), inArray(photoEvaluations.ratingStatus, ["not_requested", "pending", "error"])));
    const [fresh] = await db().select().from(photoEvaluations).where(eq(photoEvaluations.id, e.id));
    return photoRatingOutputSchema.parse(fresh!.rating);
  } catch (error) {
    if (error instanceof AiError) {
      await recordCall({
        attemptId: a.id,
        evaluationId: e.id,
        stage: "rate",
        provider: provider.name,
        model: provider.model,
        modelConfigVersion: e.modelConfigVersion,
        promptVersion: e.ratingPromptVersion,
        status: "failed",
        errorCode: error.code,
        errorDetail: error.message.slice(0, 300),
        latencyMs: error.latencyMs ?? Date.now() - started,
        queueWaitMs,
      });
    }
    throw error;
  }
}

export async function processRate(attemptId: string, deps: ProcessorDeps = {}, queueWaitMs: number | null = null) {
  const row = await loadAttempt(attemptId);
  if (!row) return { skipped: "missing" as const };
  if (row.a.verificationStatus !== "matched" || row.a.ratingStatus !== "pending") return { skipped: "done" as const };
  if (await isCancelled(attemptId)) return { skipped: "cancelled" as const };
  await setRunning(attemptId);

  let output: PhotoRatingOutput;
  try {
    output = await obtainRating(row, deps, queueWaitMs);
  } catch (error) {
    if (error instanceof StageAborted) return { skipped: "cancelled" as const };
    throw error;
  }

  return db().transaction(async (tx) => {
    const [a] = await tx.select().from(photoAttempts).where(eq(photoAttempts.id, attemptId)).for("update");
    if (!a || a.ratingStatus !== "pending" || a.cancelledAt) return { skipped: "done" as const };
    const [asset] = await tx.select({ state: assets.state }).from(assets).where(eq(assets.id, a.assetId));
    if (asset?.state !== "ready") return { skipped: "cancelled" as const };

    if (!output.scorable || !output.dimensions) {
      await tx
        .update(photoAttempts)
        .set({ ratingStatus: "unscorable", processingStatus: "succeeded", updatedAt: new Date() })
        .where(eq(photoAttempts.id, attemptId));
      return { rating: "unscorable" as const };
    }

    const { total, grade } = ratePhoto(output.dimensions);
    const [rating] = await tx
      .insert(photoRatings)
      .values({
        attemptId,
        visitorId: a.visitorId,
        mode: a.mode,
        placeId: a.placeId,
        ...output.dimensions,
        total,
        grade,
        strength: output.strength!,
        improvement: output.improvement!,
        rubricVersion: RUBRIC_VERSION,
      })
      .onConflictDoNothing()
      .returning();
    if (rating) await updateBestRating(tx, { visitorId: a.visitorId, mode: a.mode, placeId: a.placeId });
    await tx
      .update(photoAttempts)
      .set({ ratingStatus: "completed", processingStatus: "succeeded", updatedAt: new Date() })
      .where(eq(photoAttempts.id, attemptId));
    return { rating: "completed" as const, total, grade };
  });
}

/**
 * Best photo = highest numeric total under the current rubric; ties keep the
 * earlier one (spec §8.3). Only ratings whose photo still exists count.
 */
export async function updateBestRating(tx: Tx, opts: { visitorId: string; mode: "live" | "demo"; placeId: string }) {
  const best = await tx.execute<{ id: string }>(sql`
    select r.id from photo_ratings r
    join photo_attempts a on a.id = r.attempt_id
    join assets s on s.id = a.asset_id
    where r.visitor_id = ${opts.visitorId} and r.mode = ${opts.mode} and r.place_id = ${opts.placeId}
      and r.rubric_version = ${RUBRIC_VERSION} and s.state = 'ready' and a.cancelled_at is null
    order by r.total desc, r.created_at asc
    limit 1
  `);
  await tx
    .update(placeProgress)
    .set({ bestRatingId: best.rows[0]?.id ?? null, updatedAt: new Date() })
    .where(
      and(eq(placeProgress.visitorId, opts.visitorId), eq(placeProgress.mode, opts.mode), eq(placeProgress.placeId, opts.placeId)),
    );
}

// ── Failure bookkeeping ─────────────────────────────────────────────────────

/** Called when a stage has exhausted its retries or hit a non-retryable error. */
export async function markStageFailed(attemptId: string, stage: Stage, code: string) {
  await db()
    .update(photoAttempts)
    .set({
      processingStatus: "failed",
      errorCode: code,
      errorStage: stage,
      ...(stage === "verify" ? { verificationStatus: "error" as const } : { ratingStatus: "error" as const }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(photoAttempts.id, attemptId),
        stage === "verify" ? eq(photoAttempts.verificationStatus, "pending") : eq(photoAttempts.ratingStatus, "pending"),
      ),
    );
}
