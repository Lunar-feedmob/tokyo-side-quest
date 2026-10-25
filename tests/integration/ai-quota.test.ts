import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, resetData, setupDatabase, solidJpeg } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { redis, closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const auth = await import("@tsq/core/services/admin-auth");
const settings = await import("@tsq/core/services/settings");
const { aiQuotaStatus, tokyoDayStart } = await import("@tsq/core/services/ai-quota");
const { createGuestSession } = await import("@tsq/core/services/session");
const { uploadPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");
const { processVerify, processRate, markStageFailed } = await import("@tsq/core/services/processing");
const quests = await import("@tsq/core/services/quests");

const faults = {
  failVerify: async () => (await redis().get("tsq:fake-ai:fail-verify")) === "1",
  failRating: async () => (await redis().get("tsq:fake-ai:fail-rating")) === "1",
};

let ids: Record<string, string>;
let owner: { id: string; username: string; role: "owner" };

beforeAll(async () => {
  await setupDatabase();
});
beforeEach(async () => {
  await resetData();
  settings.invalidateSettingsCache();
  ids = (await createFixturePlaces()).places;
  const row = await auth.createAdmin({ username: "owner1", password: "correct horse battery", role: "owner" });
  owner = { id: row.id, username: "owner1", role: "owner" };
});
afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

const setLimit = (n: number) => settings.saveQuotaSettings(owner, { aiDailyCallLimit: n });

async function submit(visitorId: string, color: string, extra: Partial<Parameters<typeof attempts.createPhotoAttempt>[0]> = {}) {
  const upload = await uploadPhoto({ visitorId, bytes: await solidJpeg(color) });
  return attempts.createPhotoAttempt({
    visitorId,
    placeId: ids["test-gate"]!,
    assetId: upload.assetId,
    position: null,
    questRunId: null,
    questStepId: null,
    clientIp: null,
    ...extra,
  });
}

describe("daily AI call limit", () => {
  it("Tokyo days start at 15:00 UTC", () => {
    expect(tokyoDayStart(new Date("2026-10-25T14:59:59Z")).toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(tokyoDayStart(new Date("2026-10-25T15:00:00Z")).toISOString()).toBe("2026-10-25T15:00:00.000Z");
    expect(tokyoDayStart(new Date("2026-10-25T03:00:00Z")).toISOString()).toBe("2026-10-24T15:00:00.000Z");
  });

  it("uses the .env default until an owner saves a limit; saving and clearing are audited", async () => {
    expect(await settings.resolveAiDailyLimit()).toEqual({ source: "env", limit: 200 });
    expect(settings.quotaSettingsInputSchema.safeParse({ aiDailyCallLimit: 1 }).success).toBe(false);

    const view = await setLimit(50);
    expect(view.quota.effective).toEqual({ source: "settings", aiDailyCallLimit: 50 });
    expect(await settings.resolveAiDailyLimit()).toEqual({ source: "settings", limit: 50 });

    await settings.clearSettings(owner, "quota");
    expect(await settings.resolveAiDailyLimit()).toEqual({ source: "env", limit: 200 });
    const logs = await db().select().from(schema.auditLogs);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["settings.quota.save", "settings.quota.clear"]));
  });

  it("queued photos reserve their calls, and a photo that does not fit is refused without being stored", async () => {
    await setLimit(2);
    const visitorId = (await createGuestSession()).visitor.id;
    const first = await submit(visitorId, "#c7372f");
    expect(await aiQuotaStatus()).toMatchObject({ used: 0, pending: 2, exhausted: true });

    await expect(submit(visitorId, "#1c4fd6")).rejects.toMatchObject({ code: "AI_DAILY_LIMIT_REACHED", status: 429 });
    expect(await db().select().from(schema.photoAttempts)).toHaveLength(1);

    await processVerify(first.attemptId, { faults });
    await processRate(first.attemptId, { faults });
    expect(await aiQuotaStatus()).toMatchObject({ used: 2, pending: 0, exhausted: true });
    await expect(submit(visitorId, "#1c4fd6")).rejects.toMatchObject({ code: "AI_DAILY_LIMIT_REACHED" });

    await setLimit(4);
    await expect(submit(visitorId, "#1c4fd6")).resolves.toMatchObject({ created: true });
  });

  it("only today's verify and rate calls count", async () => {
    const base = { provider: "fake", model: "fake-vision-1", modelConfigVersion: "m", promptVersion: "p", status: "succeeded", latencyMs: 1 };
    const yesterday = new Date(tokyoDayStart().getTime() - 60_000);
    await db()
      .insert(schema.aiCalls)
      .values([
        { ...base, stage: "verify", createdAt: yesterday },
        { ...base, stage: "test" },
        { ...base, stage: "rate", estimatedCostUsd: 0.25 },
        { ...base, stage: "verify" },
      ]);
    expect(await aiQuotaStatus()).toMatchObject({ used: 2, pending: 0, estimatedCostUsd: 0.25, unpricedCalls: 1 });
  });

  it("a finished evaluation is reused in a new story context even when the budget is spent", async () => {
    await setLimit(2);
    const visitorId = (await createGuestSession()).visitor.id;
    const upload = await uploadPhoto({ visitorId, bytes: await solidJpeg("#c7372f") });
    const base = { visitorId, placeId: ids["test-gate"]!, assetId: upload.assetId, position: null, clientIp: null };
    const first = await attempts.createPhotoAttempt({ ...base, questRunId: null, questStepId: null });
    await processVerify(first.attemptId, { faults });
    await processRate(first.attemptId, { faults });
    expect((await aiQuotaStatus()).exhausted).toBe(true);

    const quest = await quests.getQuest("test-quest");
    const run = await quests.startQuestRun({ visitorId, mode: "live", questId: quest.id });
    const inQuest = await attempts.createPhotoAttempt({ ...base, questRunId: run.runId, questStepId: quest.steps[0]!.id });
    expect(inQuest.created).toBe(true);
  });

  it("a retry is refused while the budget is spent and allowed once there is room", async () => {
    const visitorId = (await createGuestSession()).visitor.id;
    const { attemptId } = await submit(visitorId, "#c7372f");
    await processVerify(attemptId, { faults });
    await redis().set("tsq:fake-ai:fail-rating", "1");
    await processRate(attemptId, { faults }).catch(() => undefined);
    await redis().del("tsq:fake-ai:fail-rating");
    await markStageFailed(attemptId, "rate", "AI_UNAVAILABLE");

    const { used } = await aiQuotaStatus();
    await setLimit(Math.max(2, used));
    await expect(attempts.retryAttempt({ visitorId, attemptId })).rejects.toMatchObject({ code: "AI_DAILY_LIMIT_REACHED" });
    await setLimit(used + 1);
    await expect(attempts.retryAttempt({ visitorId, attemptId })).resolves.toMatchObject({ stage: "rate" });
  });
});
