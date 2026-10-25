import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, resetData, setupDatabase, solidJpeg } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const { createGuestSession } = await import("@tsq/core/services/session");
const { uploadPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");
const { processVerify, processRate } = await import("@tsq/core/services/processing");
const auth = await import("@tsq/core/services/admin-auth");
const admin = await import("@tsq/core/services/admin");

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

async function uncertainAttempt() {
  const visitorId = (await createGuestSession()).visitor.id;
  const up = await uploadPhoto({ visitorId, bytes: await solidJpeg("#2f9e44") });
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
  const { reviewRequestId } = await attempts.requestReview({ visitorId, attemptId });
  return { visitorId, attemptId, reviewRequestId };
}

describe("admin auth", () => {
  it("hashes passwords, rejects wrong ones, and throttles repeated failures", async () => {
    await auth.createAdmin({ username: "owner1", password: "correct horse battery", role: "owner" });
    const [row] = await db().select().from(schema.admins).where(eq(schema.admins.username, "owner1"));
    expect(row?.passwordHash.startsWith("$argon2id$")).toBe(true);
    await expect(auth.adminLogin({ username: "owner1", password: "wrong", clientKey: "c1" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const ok = await auth.adminLogin({ username: "owner1", password: "correct horse battery", clientKey: "c1" });
    expect((await auth.adminFromToken(ok.token))?.role).toBe("owner");
    for (let i = 0; i < 9; i++) {
      await auth.adminLogin({ username: "owner1", password: "nope", clientKey: "c2" }).catch(() => undefined);
    }
    await expect(auth.adminLogin({ username: "owner1", password: "correct horse battery", clientKey: "c2" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("a visitor session token is never accepted as admin (I02)", async () => {
    const { token } = await createGuestSession();
    expect(await auth.adminFromToken(token)).toBeNull();
  });

  it("enforces roles", async () => {
    expect(() => auth.assertRole({ id: "x", username: "r", role: "reviewer" }, "content")).toThrow();
    expect(() => auth.assertRole({ id: "x", username: "e", role: "editor" }, "review")).not.toThrow();
  });
});

describe("manual review", () => {
  it("approve appends a human verdict, creates the check-in once, then rating continues", async () => {
    const reviewer = await auth.createAdmin({ username: "rev", password: "reviewer password 1", role: "reviewer" });
    const principal = { id: reviewer.id, username: "rev", role: "reviewer" as const };
    const { visitorId, attemptId, reviewRequestId } = await uncertainAttempt();

    const first = await admin.decideReview(principal, reviewRequestId, "approve", "招牌与参考图一致");
    expect(first).toMatchObject({ status: "approved", changed: true });
    const again = await admin.decideReview(principal, reviewRequestId, "approve", "重复提交");
    expect(again.changed).toBe(false);

    const verifications = await db().select().from(schema.placeVerifications).where(eq(schema.placeVerifications.attemptId, attemptId));
    expect(verifications.map((v) => v.source)).toEqual(["ai", "human"]);
    expect(await db().select().from(schema.checkins)).toHaveLength(1);
    expect(await db().select().from(schema.stampAwards)).toHaveLength(1);

    let view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification).toMatchObject({ status: "matched", source: "human" });
    expect(view.rating.status).toBe("pending");
    await processRate(attemptId);
    view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.rating.grade).toBe("S");

    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "review.approve"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(reviewer.id);
  });

  it("reject keeps the attempt uncertain with no rewards", async () => {
    const reviewer = await auth.createAdmin({ username: "rev2", password: "reviewer password 2", role: "reviewer" });
    const { visitorId, attemptId, reviewRequestId } = await uncertainAttempt();
    await admin.decideReview({ id: reviewer.id, username: "rev2", role: "reviewer" }, reviewRequestId, "reject", "画面中看不到门牌");
    const view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification.status).toBe("uncertain");
    expect(view.review).toMatchObject({ status: "rejected", reason: "画面中看不到门牌" });
    expect(await db().select().from(schema.checkins)).toHaveLength(0);
  });
});
