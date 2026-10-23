import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, resetData, setupDatabase, solidJpeg } from "./helpers";

const { closeDb } = await import("@tsq/core/db/client");
const { closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const { createGuestSession } = await import("@tsq/core/services/session");
const { uploadPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");
const { processVerify, processRate } = await import("@tsq/core/services/processing");
const posters = await import("@tsq/core/services/posters");

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

async function matchedAttempt(visitorId: string) {
  const up = await uploadPhoto({ visitorId, bytes: await solidJpeg("#c7372f") });
  const { attemptId } = await attempts.createPhotoAttempt({
    visitorId,
    placeId: ids["test-gate"]!,
    assetId: up.assetId,
    position: null,
    questRunId: null,
    questStepId: null,
    clientIp: null,
  });
  await processVerify(attemptId);
  await processRate(attemptId);
  return attemptId;
}

describe("posters and shares", () => {
  it("renders a PNG, shares it with a QR, and revocation kills the public page and image (I14)", async () => {
    const visitorId = (await createGuestSession()).visitor.id;
    const attemptId = await matchedAttempt(visitorId);
    const { posterId } = await posters.createPoster({
      visitorId,
      mode: "live",
      kind: "place",
      placeId: ids["test-gate"],
      coverAttemptId: attemptId,
      caption: "测试短句",
    });
    await posters.renderPoster(posterId);
    let view = await posters.getPoster({ visitorId, posterId });
    expect(view.status).toBe("ready");
    expect(view.snapshot.grade).toBe("S");
    const png = await posters.readPosterImage({ visitorId, posterId });
    expect(png.subarray(1, 4).toString()).toBe("PNG");

    const share = await posters.createShare({ visitorId, posterId });
    const token = share.url.split("/s/")[1]!;
    await posters.renderPoster(posterId);
    view = await posters.getPoster({ visitorId, posterId });
    expect(view.qrIncluded).toBe(true);

    const pub = await posters.getPublicShare(token);
    expect(pub).toMatchObject({ title: "测试门", ready: true });
    expect(Object.keys(pub).sort()).toEqual(["caption", "dateTokyo", "expiresAt", "grade", "imageUrl", "ready", "subtitle", "title"]);
    expect((await posters.readPublicShareImage(token)).subarray(1, 4).toString()).toBe("PNG");

    await posters.revokeShare({ visitorId, shareId: share.shareId });
    await expect(posters.getPublicShare(token)).rejects.toMatchObject({ code: "SHARE_UNAVAILABLE" });
    await expect(posters.readPublicShareImage(token)).rejects.toMatchObject({ code: "SHARE_UNAVAILABLE" });
  });

  it("other visitors cannot read or share someone's poster (I01)", async () => {
    const owner = (await createGuestSession()).visitor.id;
    const other = (await createGuestSession()).visitor.id;
    const attemptId = await matchedAttempt(owner);
    const { posterId } = await posters.createPoster({ visitorId: owner, mode: "live", kind: "place", placeId: ids["test-gate"], coverAttemptId: attemptId, caption: null });
    await posters.renderPoster(posterId);
    await expect(posters.getPoster({ visitorId: other, posterId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(posters.readPosterImage({ visitorId: other, posterId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(posters.createShare({ visitorId: other, posterId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      posters.createPoster({ visitorId: other, mode: "live", kind: "place", placeId: ids["test-gate"], coverAttemptId: attemptId, caption: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a poster for a place the visitor never checked in at", async () => {
    const visitorId = (await createGuestSession()).visitor.id;
    await expect(
      posters.createPoster({ visitorId, mode: "live", kind: "place", placeId: ids["test-street"], coverAttemptId: null, caption: null }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
