import { expect, test } from "@playwright/test";

// API-level checks run once (no browser needed); they hit the running server.
test.describe.configure({ mode: "serial" });

test("visitor cannot call admin APIs (I02)", async ({ request, baseURL }) => {
  const origin = { origin: baseURL! };
  expect((await request.post("/api/v1/session/guest", { headers: origin })).ok()).toBeTruthy();
  const res = await request.get("/api/v1/admin/reviews");
  expect(res.status()).toBe(401);
  const decide = await request.post("/api/v1/admin/reviews/00000000-0000-4000-8000-000000000000/decision", {
    headers: origin,
    data: { decision: "approve", reason: "x" },
  });
  expect(decide.status()).toBe(401);
});

test("client-supplied distance / grade / visitorId are rejected (I03)", async ({ request, baseURL }) => {
  const origin = { origin: baseURL! };
  await request.post("/api/v1/session/guest", { headers: origin });
  const places = await (await request.get("/api/v1/places?limit=1")).json();
  const placeId = places.data.items[0].id;
  const res = await request.post("/api/v1/checkins/location", {
    headers: origin,
    data: {
      placeId,
      position: { latitude: 35.7, longitude: 139.7, accuracyMeters: 5, capturedAt: new Date().toISOString() },
      distanceMeters: 1,
      passed: true,
      visitorId: "00000000-0000-4000-8000-000000000000",
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  const attempt = await request.post("/api/v1/photo-attempts", {
    headers: origin,
    data: { placeId, assetId: "00000000-0000-4000-8000-000000000000", grade: "SSS", total: 100 },
  });
  expect(attempt.status()).toBe(400);
});

test("same Idempotency-Key with a different body is a 409 (I04)", async ({ request, baseURL }) => {
  const headers = { origin: baseURL!, "idempotency-key": `e2e-${Date.now()}-key` };
  await request.post("/api/v1/session/guest", { headers: { origin: baseURL! } });
  const quests = await (await request.get("/api/v1/quests")).json();
  const questId = quests.data.items[0].id;
  const first = await request.post("/api/v1/demo/quest-runs", { headers, data: { questId } });
  expect(first.ok()).toBeTruthy();
  const replay = await request.post("/api/v1/demo/quest-runs", { headers, data: { questId } });
  expect(await replay.json()).toMatchObject({ data: (await first.json()).data });
  const conflict = await request.post("/api/v1/demo/quest-runs", { headers, data: { questId: "00000000-0000-4000-8000-000000000000" } });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
});

test("cross-site writes are refused", async ({ request }) => {
  const res = await request.post("/api/v1/session/guest", { headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});

test("without AI configured, live photo submission says so instead of faking (I15)", async ({ request, baseURL }) => {
  const caps = await (await request.get("/api/v1/capabilities")).json();
  test.skip(caps.data.ai.available, "AI is configured in this environment");
  const origin = { origin: baseURL! };
  await request.post("/api/v1/session/guest", { headers: origin });
  const places = await (await request.get("/api/v1/places?neighborhood=yanaka")).json();
  const photoPlace = places.data.items.find((p: { photoEnabled: boolean }) => p.photoEnabled);
  const res = await request.post("/api/v1/photo-attempts", {
    headers: origin,
    data: { placeId: photoPlace.id, assetId: "00000000-0000-4000-8000-000000000000", position: null, questRunId: null, questStepId: null },
  });
  expect(res.status()).toBe(503);
  expect((await res.json()).error.code).toBe("AI_NOT_CONFIGURED");
});
