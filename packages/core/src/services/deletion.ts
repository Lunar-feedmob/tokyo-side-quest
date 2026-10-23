import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  assets,
  photoAttempts,
  photoEvaluations,
  photoRatings,
  placeVerifications,
  posters,
  reviewRequests,
  shareLinks,
  visitors,
} from "../db/schema";
import { AppError } from "../http/errors";
import { enqueueInTx } from "../queue/outbox";
import { modelKeyFor } from "../storage/images";
import { deleteObjects } from "../storage/s3";
import { audit } from "./admin-auth";
import { renderJobId, revokeSharesForAsset } from "./posters";
import { updateBestRating } from "./processing";

// Deletion (spec §15, §9.3 item 12). The request marks everything as
// cancelled in one transaction so in-flight jobs stop producing results; the
// worker then removes stored objects and scrubs cached AI text.

export async function requestPhotoDeletion(opts: { visitorId: string; assetId: string }) {
  return db().transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.id, opts.assetId), eq(assets.ownerVisitorId, opts.visitorId), eq(assets.kind, "user_photo")))
      .for("update");
    if (!asset) throw new AppError("NOT_FOUND", "没有找到这张照片");
    if (asset.state !== "ready") return { assetId: asset.id, status: asset.state };

    await tx.update(assets).set({ state: "deleting" }).where(eq(assets.id, asset.id));
    const affected = await tx
      .update(photoAttempts)
      .set({ cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(photoAttempts.assetId, asset.id))
      .returning({ id: photoAttempts.id });
    if (affected.length) {
      await tx
        .update(reviewRequests)
        .set({ status: "cancelled", decidedAt: new Date(), reason: "用户删除了照片" })
        .where(and(inArray(reviewRequests.attemptId, affected.map((a) => a.id)), eq(reviewRequests.status, "open")));
    }
    // Shares showing this photo are revoked immediately; posters re-render without it.
    const posterIds = await revokeSharesForAsset(tx, asset.id);
    for (const id of posterIds) {
      await tx.update(posters).set({ status: "queued", updatedAt: new Date() }).where(eq(posters.id, id));
      await enqueueInTx(tx, "poster.render", id, renderJobId(id, Date.now()));
    }
    await enqueueInTx(tx, "photo.delete", asset.id, `${asset.id}:photo-delete`);
    return { assetId: asset.id, status: "deleting" as const };
  });
}

/** Worker: remove stored variants and scrub ratings/evaluations derived from the photo. */
export async function completePhotoDeletion(assetId: string) {
  const [asset] = await db().select().from(assets).where(eq(assets.id, assetId));
  if (!asset || asset.state === "deleted") return { skipped: true };
  await deleteObjects([asset.objectKey, modelKeyFor(asset.objectKey), asset.thumbKey ?? ""]);

  await db().transaction(async (tx) => {
    const attempts = await tx
      .select({ id: photoAttempts.id, placeId: photoAttempts.placeId, mode: photoAttempts.mode, evaluationId: photoAttempts.evaluationId })
      .from(photoAttempts)
      .where(eq(photoAttempts.assetId, assetId));
    const attemptIds = attempts.map((a) => a.id);
    if (attemptIds.length) {
      await tx.delete(photoRatings).where(inArray(photoRatings.attemptId, attemptIds));
      await tx
        .update(placeVerifications)
        .set({ evidence: [], userMessage: "照片已删除", reshootSuggestion: null })
        .where(inArray(placeVerifications.attemptId, attemptIds));
      await tx
        .update(photoAttempts)
        .set({ ratingStatus: sql`case when ${photoAttempts.ratingStatus} in ('completed','pending') then 'not_requested'::rating_status else ${photoAttempts.ratingStatus} end` })
        .where(inArray(photoAttempts.id, attemptIds));
    }
    // Cached AI text goes too, unless another live copy of the same image still uses it.
    const evaluationIds = [...new Set(attempts.map((a) => a.evaluationId))];
    for (const evaluationId of evaluationIds) {
      const [stillUsed] = await tx
        .select({ id: photoAttempts.id })
        .from(photoAttempts)
        .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
        .where(and(eq(photoAttempts.evaluationId, evaluationId), eq(assets.state, "ready"), ne(assets.id, assetId)))
        .limit(1);
      if (!stillUsed) {
        await tx
          .update(photoEvaluations)
          .set({ verification: null, rating: null, ratingStatus: "not_requested", updatedAt: new Date() })
          .where(eq(photoEvaluations.id, evaluationId));
      }
    }
    await tx.update(assets).set({ state: "deleted", deletedAt: new Date() }).where(eq(assets.id, assetId));
    // Best photo per place is recomputed from what is still available.
    const keys = new Set(attempts.map((a) => `${a.mode}|${a.placeId}`));
    for (const key of keys) {
      const [mode, placeId] = key.split("|") as ["live" | "demo", string];
      await updateBestRating(tx, { visitorId: asset.ownerVisitorId!, mode, placeId });
    }
  });
  return { deleted: true };
}

export async function requestVisitorDeletion(visitorId: string) {
  return db().transaction(async (tx) => {
    const [v] = await tx.select().from(visitors).where(eq(visitors.id, visitorId)).for("update");
    if (!v || v.deletedAt) return { status: "deleted" as const };
    if (!v.deletionRequestedAt) {
      await tx.update(visitors).set({ deletionRequestedAt: new Date() }).where(eq(visitors.id, visitorId));
      await tx.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.ownerVisitorId, visitorId), sql`${shareLinks.revokedAt} is null`));
      await tx.update(photoAttempts).set({ cancelledAt: new Date() }).where(and(eq(photoAttempts.visitorId, visitorId), sql`${photoAttempts.cancelledAt} is null`));
      await tx.update(assets).set({ state: "deleting" }).where(and(eq(assets.ownerVisitorId, visitorId), eq(assets.state, "ready")));
      await enqueueInTx(tx, "visitor.delete", visitorId, `${visitorId}:visitor-delete`);
    }
    return { status: "deleting" as const };
  });
}

/** Worker: delete every stored object of the visitor, then the visitor row (cascades to all records). */
export async function completeVisitorDeletion(visitorId: string) {
  const owned = await db().select().from(assets).where(eq(assets.ownerVisitorId, visitorId));
  const keys = owned.flatMap((a) => [a.objectKey, a.kind === "user_photo" ? modelKeyFor(a.objectKey) : "", a.thumbKey ?? ""]);
  await deleteObjects(keys.filter(Boolean));
  await db().transaction(async (tx) => {
    // Posters/attempts reference assets; remove dependants first, then the visitor (cascade).
    await tx.delete(posters).where(eq(posters.ownerVisitorId, visitorId));
    await tx.delete(photoAttempts).where(eq(photoAttempts.visitorId, visitorId));
    await tx.delete(visitors).where(eq(visitors.id, visitorId));
  });
  await audit({ actorType: "system", actorId: null, action: "visitor.deleted", targetType: "visitor", targetId: null, meta: { objects: keys.length } });
  return { deleted: true, objects: keys.length };
}

export async function myDeletablePhotos(visitorId: string) {
  return db()
    .select({ assetId: assets.id, createdAt: assets.createdAt, state: assets.state })
    .from(assets)
    .where(and(eq(assets.ownerVisitorId, visitorId), eq(assets.kind, "user_photo"), ne(assets.state, "deleted")))
    .orderBy(sql`${assets.createdAt} desc`)
    .limit(200);
}
