import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Integration tests run against real Postgres/PostGIS, Redis and S3 storage
// from docker compose, with the test-only fake vision provider. They never
// call a real model; the real-model smoke test is separate (docs/ai-evaluation.md).

Object.assign(process.env, {
  APP_ENV: "test",
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://tsq:tsq-local-password@127.0.0.1:5433/tsq_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/1",
  SESSION_SECRET: "test-secret-test-secret-test-secret-0123456789",
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:8333",
  STORAGE_BUCKET: "tsq-test",
  STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID ?? "tsq-local-access",
  STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY ?? "tsq-local-secret-change-me",
  AI_PROVIDER: "fake",
  DEMO_ENABLED: "true",
  PHOTO_ATTEMPTS_PER_HOUR: "1000",
  PHOTO_ATTEMPTS_PER_IP_PER_HOUR: "1000",
});

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { sql } = await import("drizzle-orm");
const { db } = await import("@tsq/core/db/client");
const { redis } = await import("@tsq/core/infra/redis");
const { ensureBucket } = await import("@tsq/core/storage/s3");
const seedLib = await import("@tsq/core/db/seed-lib");

export async function setupDatabase() {
  await migrate(db(), {
    migrationsFolder: fileURLToPath(new URL("../../packages/core/src/db/migrations", import.meta.url)),
  });
  await ensureBucket();
}

export async function resetData() {
  await db().execute(sql`
    truncate table app_settings, audit_logs, ai_calls, outbox_events, idempotency_keys, share_links, posters,
      review_requests, stamp_awards, place_progress, quest_step_progress, checkins, photo_ratings,
      place_verifications, photo_attempts, photo_evaluations, quest_runs, quest_steps, quest_versions,
      quests, reference_images, place_versions, places, neighborhoods, assets, admin_sessions, admins,
      sessions, visitors restart identity cascade
  `);
  await redis().flushdb();
}

export function solidJpeg(color: string, size = 96): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } }).jpeg().toBuffer();
}

/** Clearly fictitious test geography: not a real Tokyo check-in point. */
export const TEST_ORIGIN = { latitude: 10.0, longitude: 20.0 };

export async function createFixturePlaces() {
  const references = await Promise.all(["#c7372f", "#b0302a", "#d24038"].map((c) => solidJpeg(c, 128)));
  return seedLib.seedContent({
    neighborhood: {
      slug: "test-town",
      nameZh: "测试街区",
      nameJa: "テスト街",
      nameEn: "Test Town",
      summary: "仅用于自动化测试",
      center: TEST_ORIGIN,
    },
    places: [
      {
        slug: "test-gate",
        nameZh: "测试门",
        nameJa: "テスト門",
        nameEn: "Test Gate",
        latitude: TEST_ORIGIN.latitude,
        longitude: TEST_ORIGIN.longitude,
        radiusM: 100,
        photoEnabled: true,
        tags: ["测试"],
        stayMinutes: 10,
        content: testContent("红色大门"),
        references: references.map((bytes, i) => ({
          bytes,
          viewNote: `测试参考 ${i + 1}`,
          sourceUrl: "https://example.invalid/test",
          author: "test",
          license: "test-fixture",
          usageBasis: "自动化测试生成的纯色图片",
          publicDisplay: false,
        })),
      },
      {
        slug: "test-street",
        nameZh: "测试街",
        nameJa: "テスト通り",
        nameEn: null,
        latitude: TEST_ORIGIN.latitude + 0.003,
        longitude: TEST_ORIGIN.longitude,
        radiusM: 80,
        photoEnabled: false,
        tags: ["测试"],
        stayMinutes: 5,
        content: testContent("普通街道"),
        references: [],
      },
    ],
    quests: [
      {
        slug: "test-quest",
        title: "测试故事",
        subtitle: "",
        intro: "测试开场",
        ending: "测试结局",
        estimatedMinutes: 30,
        fictionNote: "虚构测试内容",
        steps: [
          { placeSlug: "test-gate", proofPolicy: "either", title: "第一站", story: "s", objective: "o", clue: "c", observationQuestion: "q", completionText: "done" },
          { placeSlug: "test-street", proofPolicy: "location", title: "第二站", story: "s", objective: "o", clue: "c", observationQuestion: "q", completionText: "done" },
        ],
      },
    ],
    sampleImages: async (slug) => ({
      match: await solidJpeg("#c7372f"),
      unclear: await solidJpeg("#2f9e44"),
      other: await solidJpeg("#1c4fd6"),
      slug,
    }),
  });
}

function testContent(feature: string) {
  return {
    intro: "测试地点简介",
    cultureNote: "测试文化说明",
    cultureSources: [{ label: "test", url: "https://example.invalid", accessedOn: "2026-10-23" }],
    shootingTips: "测试拍摄提示",
    distinctiveFeatures: [feature, "周边结构"],
    confusablePlaces: [],
    unsuitableAngles: [],
    restrictions: null,
    coordinateSource: { label: "test", url: "https://example.invalid", accessedOn: "2026-10-23" },
    verificationLevel: "desk" as const,
  };
}

/** Position reading `metersNorth` from a place, captured now. */
export function positionNear(place: { latitude: number; longitude: number }, metersNorth: number, accuracyMeters = 10) {
  return {
    latitude: place.latitude + metersNorth / 111_195,
    longitude: place.longitude,
    accuracyMeters,
    capturedAt: new Date().toISOString(),
  };
}
