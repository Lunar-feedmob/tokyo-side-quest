import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, positionNear, resetData, setupDatabase, solidJpeg, TEST_ORIGIN } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { redis, closeRedis } = await import("@tsq/core/infra/redis");
const { createGuestSession } = await import("@tsq/core/services/session");
const { uploadPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");
const { processVerify, processRate, markStageFailed } = await import("@tsq/core/services/processing");
const { locationCheckin } = await import("@tsq/core/services/checkins");
const quests = await import("@tsq/core/services/quests");
const { enqueueInTx, publishOutboxBatch, queueJobId } = await import("@tsq/core/queue/outbox");
const { requestVisitorDeletion } = await import("@tsq/core/services/deletion");
const { closeQueues, queue, QUEUES } = await import("@tsq/core/queue/queues");
const { AppError } = await import("@tsq/core/http/errors");
const { AiError } = await import("@tsq/core/ai/index");
const { resetEnvCache } = await import("@tsq/core/config/env");

const faults = {
  failVerify: async () => (await redis().get("tsq:fake-ai:fail-verify")) === "1",
  failRating: async () => (await redis().get("tsq:fake-ai:fail-rating")) === "1",
};

let ids: Record<string, string>;

beforeAll(async () => {
  await setupDatabase();
});
beforeEach(async () => {
  await resetData();
  ids = (await createFixturePlaces()).places;
});
afterAll(async () => {
  await queue(QUEUES.attempts).obliterate({ force: true }).catch(() => undefined);
  await queue(QUEUES.maintenance).obliterate({ force: true }).catch(() => undefined);
  await closeQueues();
  await closeRedis();
  await closeDb();
});

async function newVisitor() {
  return (await createGuestSession()).visitor.id;
}

async function submit(visitorId: string, color: string, extra: Partial<Parameters<typeof attempts.createPhotoAttempt>[0]> = {}) {
  const upload = await uploadPhoto({ visitorId, bytes: await solidJpeg(color) });
  return attempts.createPhotoAttempt({
    visitorId,
    placeId: ids["test-gate"]!,
    assetId: upload.assetId,
    position: null,
    questRunId: null,
    questStepId: null,
    clientIp: "127.0.0.1",
    ...extra,
  });
}

async function runAll(attemptId: string) {
  await processVerify(attemptId, { faults });
  const view = await attempts.getAttemptView({ visitorId: (await attemptOwner(attemptId))!, attemptId });
  if (view.verification.status === "matched") await processRate(attemptId, { faults });
}

async function attemptOwner(attemptId: string) {
  const [a] = await db().select({ v: schema.photoAttempts.visitorId }).from(schema.photoAttempts).where(eq(schema.photoAttempts.id, attemptId));
  return a?.v;
}

describe("photo vertical chain", () => {
  it("matched photo → check-in, stamp, rating S 87, restorable view", async () => {
    const visitorId = await newVisitor();
    const { attemptId, created } = await submit(visitorId, "#c7372f");
    expect(created).toBe(true);

    let view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.processingStatus).toBe("queued");
    expect(view.verification.status).toBe("pending");
    expect(view.rating.status).toBe("not_requested");

    // Outbox row exists in the same transaction (spec §9.3 item 1).
    const outbox = await db().select().from(schema.outboxEvents);
    expect(outbox.map((o) => o.jobId)).toEqual([`${attemptId}:verify:0`]);

    await processVerify(attemptId, { faults });
    view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification.status).toBe("matched");
    expect(view.rating.status).toBe("pending");
    expect(view.checkin).toMatchObject({ method: "photo", arrivalVerified: false, label: "照片地点匹配 · 未核验到访" });

    await processRate(attemptId, { faults });
    view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.processingStatus).toBe("succeeded");
    expect(view.rating).toMatchObject({ status: "completed", total: 87, grade: "S" });
    expect(view.rating.dimensions).toEqual({ composition: 88, lighting: 82, clarity: 90, expression: 86 });

    const stamps = await db().select().from(schema.stampAwards).where(eq(schema.stampAwards.visitorId, visitorId));
    expect(stamps.map((s) => s.stampKey)).toEqual(["place:test-gate"]);
    const [progress] = await db().select().from(schema.placeProgress).where(eq(schema.placeProgress.visitorId, visitorId));
    expect(progress?.bestRatingId).toBeTruthy();
  });

  it("mismatched photo never gets a rating, not even D (R06)", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#1c4fd6");
    await runAll(attemptId);
    const view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification.status).toBe("mismatched");
    expect(view.processingStatus).toBe("succeeded");
    expect(view.rating).toMatchObject({ status: "not_requested", grade: null, total: null });
    expect(view.checkin).toBeNull();
    expect(await db().select().from(schema.photoRatings)).toHaveLength(0);
    expect(await db().select().from(schema.stampAwards)).toHaveLength(0);
  });

  it("uncertain photo can request one review", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#2f9e44");
    await runAll(attemptId);
    const view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification.status).toBe("uncertain");
    expect(view.canRequestReview).toBe(true);
    await attempts.requestReview({ visitorId, attemptId });
    await expect(attempts.requestReview({ visitorId, attemptId })).rejects.toMatchObject({ code: "REVIEW_ALREADY_REQUESTED" });
  });

  it("same photo + same context returns the existing attempt; new context reuses the evaluation (I11)", async () => {
    const visitorId = await newVisitor();
    const bytes = await solidJpeg("#c7372f");
    const up1 = await uploadPhoto({ visitorId, bytes });
    const up2 = await uploadPhoto({ visitorId, bytes });
    const base = { visitorId, placeId: ids["test-gate"]!, position: null, questRunId: null, questStepId: null, clientIp: null };
    const first = await attempts.createPhotoAttempt({ ...base, assetId: up1.assetId });
    const again = await attempts.createPhotoAttempt({ ...base, assetId: up2.assetId });
    expect(again).toEqual({ attemptId: first.attemptId, created: false });

    await runAll(first.attemptId);
    const quest = await quests.getQuest("test-quest");
    const run = await quests.startQuestRun({ visitorId, mode: "live", questId: quest.id });
    const step1 = quest.steps[0]!;
    const inQuest = await attempts.createPhotoAttempt({ ...base, assetId: up1.assetId, questRunId: run.runId, questStepId: step1.id });
    expect(inQuest.created).toBe(true);
    expect(inQuest.attemptId).not.toBe(first.attemptId);

    await runAll(inQuest.attemptId);
    // Reused cached evaluation: only one AI verify call and one rate call in total.
    const calls = await db().select().from(schema.aiCalls);
    expect(calls.filter((c) => c.stage === "verify")).toHaveLength(1);
    expect(calls.filter((c) => c.stage === "rate")).toHaveLength(1);
    const runView = await quests.getQuestRun({ visitorId, runId: run.runId });
    expect(runView.steps[0]!.status).toBe("completed");
    // Place stamp still awarded only once.
    expect(await db().select().from(schema.stampAwards)).toHaveLength(1);
  });

  it("duplicate job delivery does not duplicate check-ins, ratings or stamps (R10, I07)", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#c7372f");
    await Promise.all([processVerify(attemptId, { faults }), processVerify(attemptId, { faults })]);
    await processVerify(attemptId, { faults });
    await Promise.all([processRate(attemptId, { faults }), processRate(attemptId, { faults })]);
    expect(await db().select().from(schema.checkins)).toHaveLength(1);
    expect(await db().select().from(schema.photoRatings)).toHaveLength(1);
    expect(await db().select().from(schema.stampAwards)).toHaveLength(1);
    expect(await db().select().from(schema.placeVerifications)).toHaveLength(1);
  });

  it("rating failure keeps the check-in; retry re-runs rating only (I06)", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#c7372f");
    await processVerify(attemptId, { faults });
    await redis().set("tsq:fake-ai:fail-rating", "1");
    await expect(processRate(attemptId, { faults })).rejects.toBeInstanceOf(AiError);
    await markStageFailed(attemptId, "rate", "AI_UNAVAILABLE");
    let view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view).toMatchObject({ processingStatus: "failed", canRetry: "rate" });
    expect(view.verification.status).toBe("matched");
    expect(view.rating.status).toBe("error");
    expect(view.checkin).not.toBeNull();

    await redis().del("tsq:fake-ai:fail-rating");
    const retry = await attempts.retryAttempt({ visitorId, attemptId });
    expect(retry.stage).toBe("rate");
    await processRate(attemptId, { faults });
    view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.rating.grade).toBe("S");
    expect(await db().select().from(schema.checkins)).toHaveLength(1);
    expect(await db().select().from(schema.placeVerifications)).toHaveLength(1);
  });

  it("verification technical error is an error, not a mismatch", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#c7372f");
    await redis().set("tsq:fake-ai:fail-verify", "1");
    await expect(processVerify(attemptId, { faults })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    await markStageFailed(attemptId, "verify", "AI_UNAVAILABLE");
    const view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.verification.status).toBe("error");
    expect(view.canRetry).toBe("verify");
    expect(await db().select().from(schema.placeVerifications)).toHaveLength(0);
    const calls = await db().select().from(schema.aiCalls);
    expect(calls[0]).toMatchObject({ status: "failed", errorCode: "AI_UNAVAILABLE" });
    await redis().del("tsq:fake-ai:fail-verify");
  });

  it("other visitors cannot read an attempt (I01)", async () => {
    const owner = await newVisitor();
    const other = await newVisitor();
    const { attemptId } = await submit(owner, "#c7372f");
    await expect(attempts.getAttemptView({ visitorId: other, attemptId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("photo check-in is refused for a location-only place", async () => {
    const visitorId = await newVisitor();
    await expect(submit(visitorId, "#c7372f", { placeId: ids["test-street"]! })).rejects.toMatchObject({
      code: "PHOTO_CHECKIN_UNAVAILABLE",
    });
  });

  it("outbox rows publish to the queue with stable job ids (I05)", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await submit(visitorId, "#c7372f");
    expect(await publishOutboxBatch()).toBe(1);
    expect(await publishOutboxBatch()).toBe(0);
    const job = await queue(QUEUES.attempts).getJob(queueJobId(`${attemptId}:verify:0`));
    expect(job?.name).toBe("verify");
    const [row] = await db().select().from(schema.outboxEvents);
    expect(row?.publishedAt).not.toBeNull();
  });

  it("a visitor deletion request reaches the queue (its stored job id has a single colon)", async () => {
    const visitorId = await newVisitor();
    await requestVisitorDeletion(visitorId);
    expect(await publishOutboxBatch()).toBe(1);
    const [row] = await db().select().from(schema.outboxEvents);
    expect(row?.jobId).toBe(`${visitorId}:visitor-delete`);
    expect(row?.publishedAt).not.toBeNull();
    expect(row?.lastError).toBeNull();
    const job = await queue(QUEUES.maintenance).getJob(queueJobId(`${visitorId}:visitor-delete`));
    expect(job?.name).toBe("visitor-delete");
  });

  it("a row the queue refuses is recorded and skipped; rows behind it still publish", async () => {
    // BullMQ refuses integer custom ids, which stands in for any id it will never accept.
    const refused = crypto.randomUUID();
    await enqueueInTx(db(), "visitor.delete", refused, "424242");
    const visitorId = await newVisitor();
    await requestVisitorDeletion(visitorId);

    const failures: { id: number; error: string }[] = [];
    expect(await publishOutboxBatch(50, (f) => failures.push(f))).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toMatch(/integer/u);

    const rows = await db().select().from(schema.outboxEvents).orderBy(schema.outboxEvents.id);
    expect(rows[0]).toMatchObject({ aggregateId: refused, publishedAt: null, publishAttempts: 1 });
    expect(rows[0]!.lastError).toMatch(/integer/u);
    expect(rows[1]!.publishedAt).not.toBeNull();
    expect(await queue(QUEUES.maintenance).getJob(queueJobId(`${visitorId}:visitor-delete`))).toBeTruthy();

    // A later batch tries fresh rows first and the refused row again after them.
    const fresh = await newVisitor();
    await requestVisitorDeletion(fresh);
    expect(await publishOutboxBatch(1)).toBe(1);
    expect(await queue(QUEUES.maintenance).getJob(queueJobId(`${fresh}:visitor-delete`))).toBeTruthy();
  });

  it("without AI configured, live submission is refused instead of faked (I15)", async () => {
    const visitorId = await newVisitor();
    const upload = await uploadPhoto({ visitorId, bytes: await solidJpeg("#c7372f") });
    const prev = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "";
    resetEnvCache();
    try {
      await expect(
        attempts.createPhotoAttempt({
          visitorId,
          placeId: ids["test-gate"]!,
          assetId: upload.assetId,
          position: null,
          questRunId: null,
          questStepId: null,
          clientIp: null,
        }),
      ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    } finally {
      process.env.AI_PROVIDER = prev;
      resetEnvCache();
    }
    expect(await db().select().from(schema.photoAttempts)).toHaveLength(0);
  });
});

describe("location check-in and quests", () => {
  it("in range passes, server distance used; out of range and inaccurate fail (R07, R08)", async () => {
    const visitorId = await newVisitor();
    const place = TEST_ORIGIN;
    const ok = await locationCheckin({
      visitorId,
      mode: "live",
      placeId: ids["test-gate"]!,
      position: positionNear(place, 30),
      simulated: false,
      questRunId: null,
      questStepId: null,
    });
    expect(ok.checkin.arrivalVerified).toBe(true);
    expect(ok.checkin.distanceMeters).toBeGreaterThan(25);
    expect(ok.checkin.distanceMeters).toBeLessThan(35);
    expect(ok.effects.stampsAwarded).toEqual(["place:test-gate"]);

    const base = { visitorId, mode: "live" as const, placeId: ids["test-gate"]!, simulated: false, questRunId: null, questStepId: null };
    await expect(locationCheckin({ ...base, position: positionNear(place, 500) })).rejects.toMatchObject({ code: "LOCATION_OUT_OF_RANGE" });
    await expect(locationCheckin({ ...base, position: positionNear(place, 10, 80) })).rejects.toMatchObject({ code: "LOCATION_INACCURATE" });
    const stale = { ...positionNear(place, 10), capturedAt: new Date(Date.now() - 5 * 60_000).toISOString() };
    await expect(locationCheckin({ ...base, position: stale })).rejects.toMatchObject({ code: "LOCATION_STALE" });

    // A second valid check-in keeps the record but does not re-award the stamp.
    const again = await locationCheckin({ ...base, position: positionNear(place, 5) });
    expect(again.effects.stampsAwarded).toEqual([]);
  });

  it("simulated location is rejected unless enabled", async () => {
    const visitorId = await newVisitor();
    await expect(
      locationCheckin({
        visitorId,
        mode: "live",
        placeId: ids["test-gate"]!,
        position: positionNear(TEST_ORIGIN, 1),
        simulated: true,
        questRunId: null,
        questStepId: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("quest completes once all required steps are done; completion stamp awarded once", async () => {
    const visitorId = await newVisitor();
    const quest = await quests.getQuest("test-quest");
    const run = await quests.startQuestRun({ visitorId, mode: "live", questId: quest.id });
    const again = await quests.startQuestRun({ visitorId, mode: "live", questId: quest.id });
    expect(again).toEqual({ runId: run.runId, created: false });

    const [s1, s2] = quest.steps;
    const street = { latitude: TEST_ORIGIN.latitude + 0.003, longitude: TEST_ORIGIN.longitude };
    // Step 2 is location-only: a wrong place for step 1 is rejected.
    await expect(
      locationCheckin({ visitorId, mode: "live", placeId: ids["test-street"]!, position: positionNear(street, 0), simulated: false, questRunId: run.runId, questStepId: s1!.id }),
    ).rejects.toMatchObject({ code: "QUEST_STEP_MISMATCH" });

    await locationCheckin({ visitorId, mode: "live", placeId: ids["test-gate"]!, position: positionNear(TEST_ORIGIN, 0), simulated: false, questRunId: run.runId, questStepId: s1!.id });
    let view = await quests.getQuestRun({ visitorId, runId: run.runId });
    expect(view.status).toBe("active");
    expect(view.currentStepId).toBe(s2!.id);
    expect(view.quest.ending).toBeNull();

    // End and resume keeps progress.
    await quests.endQuestRun({ visitorId, runId: run.runId });
    expect((await quests.getQuestRun({ visitorId, runId: run.runId })).status).toBe("ended_partial");
    await expect(
      locationCheckin({ visitorId, mode: "live", placeId: ids["test-street"]!, position: positionNear(street, 0), simulated: false, questRunId: run.runId, questStepId: s2!.id }),
    ).rejects.toMatchObject({ code: "QUEST_STEP_MISMATCH" });
    await quests.resumeQuestRun({ visitorId, runId: run.runId });

    const results = await Promise.allSettled([
      locationCheckin({ visitorId, mode: "live", placeId: ids["test-street"]!, position: positionNear(street, 0), simulated: false, questRunId: run.runId, questStepId: s2!.id }),
      locationCheckin({ visitorId, mode: "live", placeId: ids["test-street"]!, position: positionNear(street, 1), simulated: false, questRunId: run.runId, questStepId: s2!.id }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    view = await quests.getQuestRun({ visitorId, runId: run.runId });
    expect(view.status).toBe("completed");
    expect(view.quest.ending).toBe("测试结局");
    const stamps = await db().select().from(schema.stampAwards).where(eq(schema.stampAwards.visitorId, visitorId));
    expect(stamps.map((s) => s.stampKey).sort()).toEqual(["place:test-gate", "place:test-street", "quest:test-quest"]);
    const progress = await db().select().from(schema.questStepProgress);
    expect(progress).toHaveLength(2);
  });

  it("demo and live progress are isolated (I13)", async () => {
    const visitorId = await newVisitor();
    await locationCheckin({ visitorId, mode: "demo", placeId: ids["test-gate"]!, position: positionNear(TEST_ORIGIN, 0), simulated: true, questRunId: null, questStepId: null });
    const live = await db()
      .select()
      .from(schema.stampAwards)
      .where(sql`${schema.stampAwards.visitorId} = ${visitorId} and ${schema.stampAwards.mode} = 'live'`);
    expect(live).toHaveLength(0);
    const demo = await db().select().from(schema.stampAwards).where(eq(schema.stampAwards.mode, "demo"));
    expect(demo).toHaveLength(1);
  });

  it("demo attempt uses fixed labelled sample results, isolated from live", async () => {
    const visitorId = await newVisitor();
    const { attemptId } = await attempts.createDemoAttempt({
      visitorId,
      placeId: ids["test-gate"]!,
      sampleKey: "test-gate--match",
      questRunId: null,
      questStepId: null,
    });
    await processVerify(attemptId);
    await processRate(attemptId);
    const view = await attempts.getAttemptView({ visitorId, attemptId });
    expect(view.mode).toBe("demo");
    expect(view.verification.source).toBe("demo_sample");
    expect(view.verification.message).toContain("试玩样例结果");
    expect(view.rating.grade).toBe("S");
    expect(await db().select().from(schema.aiCalls)).toHaveLength(0);
    await expect(
      attempts.createDemoAttempt({ visitorId, placeId: ids["test-gate"]!, sampleKey: "anything-else", questRunId: null, questStepId: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
