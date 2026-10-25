import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, resetData, setupDatabase, solidJpeg } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const { createGuestSession, visitorFromToken } = await import("@tsq/core/services/session");
const { uploadPhoto, readOwnPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");
const { processVerify, processRate } = await import("@tsq/core/services/processing");
const posters = await import("@tsq/core/services/posters");
const deletion = await import("@tsq/core/services/deletion");
const { getObject } = await import("@tsq/core/storage/s3");

let ids: Record<string, string>;
beforeAll(async () => setupDatabase());
beforeEach(async () => {
  await resetData();
  ids = (await createFixturePlaces()).places;
});
afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

async function submit(visitorId: string) {
  const up = await uploadPhoto({ visitorId, bytes: await solidJpeg("#c7372f") });
  const r = await attempts.createPhotoAttempt({
    visitorId,
    placeId: ids["test-gate"]!,
    assetId: up.assetId,
    position: null,
    questRunId: null,
    questStepId: null,
    clientIp: null,
  });
  return { assetId: up.assetId, attemptId: r.attemptId };
}

describe("photo deletion", () => {
  it("a result arriving after deletion started does not resurrect the photo or award anything (I10)", async () => {
    const visitorId = (await createGuestSession()).visitor.id;
    const { assetId, attemptId } = await submit(visitorId);
    await deletion.requestPhotoDeletion({ visitorId, assetId });
    const result = await processVerify(attemptId);
    expect(result).toMatchObject({ skipped: "cancelled" });
    expect(await db().select().from(schema.checkins)).toHaveLength(0);
    expect(await db().select().from(schema.stampAwards)).toHaveLength(0);
    await deletion.completePhotoDeletion(assetId);
    const [asset] = await db().select().from(schema.assets).where(eq(schema.assets.id, assetId));
    expect(asset?.state).toBe("deleted");
    await expect(getObject(asset!.objectKey)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    await expect(readOwnPhoto({ visitorId, assetId, variant: "thumb" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleting a cover photo revokes its share, scrubs rating text, keeps the stamp (I14)", async () => {
    const visitorId = (await createGuestSession()).visitor.id;
    const { assetId, attemptId } = await submit(visitorId);
    await processVerify(attemptId);
    await processRate(attemptId);
    const { posterId } = await posters.createPoster({ visitorId, mode: "live", kind: "place", placeId: ids["test-gate"], coverAttemptId: attemptId, caption: null });
    await posters.renderPoster(posterId);
    const share = await posters.createShare({ visitorId, posterId });
    const token = share.url.split("/s/")[1]!;
    await posters.renderPoster(posterId);
    expect((await posters.getPublicShare(token)).ready).toBe(true);

    await deletion.requestPhotoDeletion({ visitorId, assetId });
    await expect(posters.getPublicShare(token)).rejects.toMatchObject({ code: "SHARE_UNAVAILABLE" });
    await deletion.completePhotoDeletion(assetId);
    await posters.renderPoster(posterId); // re-render falls back to the brand cover

    expect(await db().select().from(schema.photoRatings)).toHaveLength(0);
    const [evaluation] = await db().select().from(schema.photoEvaluations);
    expect(evaluation?.rating).toBeNull();
    expect(evaluation?.verification).toBeNull();
    const [pv] = await db().select().from(schema.placeVerifications);
    expect(pv?.userMessage).toBe("照片已删除");
    const [progress] = await db().select().from(schema.placeProgress);
    expect(progress?.bestRatingId).toBeNull();
    // Non-photo facts remain.
    expect(await db().select().from(schema.stampAwards)).toHaveLength(1);
    expect((await posters.getPoster({ visitorId, posterId })).status).toBe("ready");
  });
});

describe("visitor deletion", () => {
  it("removes all records and stored objects; the session stops working", async () => {
    const { token, visitor } = await createGuestSession();
    const { assetId, attemptId } = await submit(visitor.id);
    await processVerify(attemptId);
    await processRate(attemptId);
    const [asset] = await db().select().from(schema.assets).where(eq(schema.assets.id, assetId));

    await deletion.requestVisitorDeletion(visitor.id);
    const during = await visitorFromToken(token);
    expect(during?.deletionRequestedAt).not.toBeNull();
    await deletion.completeVisitorDeletion(visitor.id);

    expect(await visitorFromToken(token)).toBeNull();
    for (const table of [schema.visitors, schema.photoAttempts, schema.checkins, schema.stampAwards, schema.photoRatings, schema.photoEvaluations, schema.sessions]) {
      expect(await db().select().from(table)).toHaveLength(0);
    }
    await expect(getObject(asset!.objectKey)).rejects.toBeTruthy();
  });
});
