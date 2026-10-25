import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, positionNear, resetData, setupDatabase, solidJpeg, TEST_ORIGIN } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const auth = await import("@tsq/core/services/admin-auth");
const admin = await import("@tsq/core/services/admin");
const survey = await import("@tsq/core/services/survey");

let ids: Record<string, string>;
let editor: { id: string; username: string; role: "editor" };

beforeAll(async () => {
  await setupDatabase();
});
beforeEach(async () => {
  await resetData();
  ids = (await createFixturePlaces()).places;
  const row = await auth.createAdmin({ username: "surveyor", password: "correct horse battery", role: "editor" });
  editor = { id: row.id, username: "surveyor", role: "editor" };
});
afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

describe("field survey", () => {
  it("stores GPS samples and notes with the distance from the current check-in point", async () => {
    const placeId = ids["test-gate"]!;
    const at = positionNear(TEST_ORIGIN, 30, 8);
    await survey.addSurveyEntry(editor, placeId, survey.surveyEntryInputSchema.parse({ kind: "position", label: "checkpoint", latitude: at.latitude, longitude: at.longitude, accuracyM: 8, readings: 12 }));
    const view = await survey.addSurveyEntry(editor, placeId, survey.surveyEntryInputSchema.parse({ kind: "note", note: "门口有禁止拍照的告示" }));

    expect(view.point).toMatchObject({ latitude: TEST_ORIGIN.latitude, longitude: TEST_ORIGIN.longitude, radiusM: 100 });
    expect(view.entries).toHaveLength(2);
    expect(view.entries[0]).toMatchObject({ kind: "position", label: "checkpoint", accuracyM: 8, readings: 12 });
    expect(view.entries[0]!.distanceM).toBeGreaterThanOrEqual(29);
    expect(view.entries[0]!.distanceM).toBeLessThanOrEqual(31);
    expect(view.entries[1]).toMatchObject({ kind: "note", note: "门口有禁止拍照的告示", distanceM: null });

    // Audit says a sample exists, never where the admin stood.
    const logs = await db().select().from(schema.auditLogs);
    expect(logs.filter((l) => l.action === "survey.add")).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain(String(at.latitude));

    const after = await survey.deleteSurveyEntry(editor, placeId, view.entries[1]!.id);
    expect(after.entries).toHaveLength(1);
    await expect(survey.deleteSurveyEntry(editor, ids["test-street"]!, view.entries[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects malformed entries", () => {
    expect(survey.surveyEntryInputSchema.safeParse({ kind: "position", label: "checkpoint", latitude: 91, longitude: 20, accuracyM: 5, readings: 1 }).success).toBe(false);
    expect(survey.surveyEntryInputSchema.safeParse({ kind: "position", label: "roof", latitude: 10, longitude: 20, accuracyM: 5, readings: 1 }).success).toBe(false);
    expect(survey.surveyEntryInputSchema.safeParse({ kind: "note", note: "  " }).success).toBe(false);
  });

  it("accepts a reference photo taken by the project without a source URL", async () => {
    const meta = admin.referenceUploadSchema.parse({
      viewNote: "西端，朝东平视",
      sourceUrl: null,
      author: "实地踏勘者",
      license: "自摄",
      usageBasis: "拍摄者授权东京支线项目用作地点核验参考图",
      publicDisplay: false,
      capturedOn: "2026-11-01",
      aiGenerated: false,
    });
    await admin.adminAddReference(editor, ids["test-gate"]!, await solidJpeg("#8a6d3b", 640), meta);
    const refs = await db().select().from(schema.referenceImages);
    expect(refs.find((r) => r.author === "实地踏勘者")).toMatchObject({ sourceUrl: null, license: "自摄" });
    const listed = await admin.adminListPlaces();
    expect(listed.find((p) => p.id === ids["test-gate"])!.referenceCount).toBe(refs.filter((r) => r.placeId === ids["test-gate"] && r.status === "active").length);
    expect(() => admin.referenceUploadSchema.parse({ ...meta, author: "" })).toThrow();
  });
});
