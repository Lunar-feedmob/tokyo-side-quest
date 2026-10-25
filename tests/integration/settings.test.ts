import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixturePlaces, resetData, setupDatabase, solidJpeg } from "./helpers";

const { db, closeDb } = await import("@tsq/core/db/client");
const schema = await import("@tsq/core/db/schema");
const { closeRedis } = await import("@tsq/core/infra/redis");
const { closeQueues } = await import("@tsq/core/queue/queues");
const auth = await import("@tsq/core/services/admin-auth");
const settings = await import("@tsq/core/services/settings");
const { testAiSettings } = await import("@tsq/core/services/ai-connection");
const { aiVersions } = await import("@tsq/core/ai/index");
const { createGuestSession } = await import("@tsq/core/services/session");
const { uploadPhoto } = await import("@tsq/core/services/photos");
const attempts = await import("@tsq/core/services/attempts");

const KEY = "sk-test-secret-value-9876";
let owner: { id: string; username: string; role: "owner" };

// Minimal OpenAI-compatible endpoint: 401 for a wrong key, a valid rating otherwise.
let server: Server;
let baseUrl: string;
const seen: { auth: string | undefined; model: string; hasImage: boolean }[] = [];

beforeAll(async () => {
  await setupDatabase();
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { model: string; messages: { content: unknown }[] };
      seen.push({ auth: req.headers.authorization, model: body.model, hasImage: raw.includes('"image_url"') });
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401).end("{}");
        return;
      }
      const output = { scorable: false, dimensions: null, strength: null, improvement: null, unscorableReason: "纯色图片，无法评价。" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], usage: { prompt_tokens: 10 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
beforeEach(async () => {
  await resetData();
  settings.invalidateSettingsCache();
  const row = await auth.createAdmin({ username: "owner1", password: "correct horse battery", role: "owner" });
  owner = { id: row.id, username: "owner1", role: "owner" };
});
afterAll(async () => {
  server.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
});

const input = (over: Partial<Record<string, unknown>> = {}) =>
  settings.aiSettingsInputSchema.parse({ provider: "openai-compatible", baseUrl, model: "vision-a", apiKey: KEY, ...over });

describe("AI settings", () => {
  it("falls back to the environment when nothing is saved", async () => {
    const ai = await settings.resolveAi();
    expect(ai).toMatchObject({ source: "env", provider: "fake", configured: true });
  });

  it("saved settings take precedence, the key is sealed and never returned or audited", async () => {
    const view = await settings.saveAiSettings(owner, input());
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(view.ai.saved?.apiKeyHint).toBe("…9876");

    const [row] = await db().select().from(schema.appSettings);
    expect(JSON.stringify(row!.value)).not.toContain(KEY);
    const logs = await db().select().from(schema.auditLogs);
    expect(logs.map((l) => l.action)).toContain("settings.ai.save");
    expect(JSON.stringify(logs)).not.toContain(KEY);

    const ai = await settings.resolveAi();
    expect(ai).toMatchObject({ source: "settings", provider: "openai-compatible", model: "vision-a", apiKey: KEY, configured: true });
  });

  it("a blank key keeps the saved one; changing the model changes the config version", async () => {
    await settings.saveAiSettings(owner, input());
    const v1 = (await aiVersions())!;
    await settings.saveAiSettings(owner, input({ apiKey: "", model: "vision-b" }));
    const ai = await settings.resolveAi();
    expect(ai.apiKey).toBe(KEY);
    const v2 = (await aiVersions())!;
    expect(v2.model).toBe("vision-b");
    expect(v2.modelConfigVersion).not.toBe(v1.modelConfigVersion);
  });

  it("rejects an OpenAI-compatible config without an endpoint, and a first save without a key", async () => {
    expect(() => settings.aiSettingsInputSchema.parse({ provider: "openai-compatible", model: "m", apiKey: KEY })).toThrow();
    await expect(settings.saveAiSettings(owner, input({ apiKey: "" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("an undecryptable key disables photo verification honestly", async () => {
    await db().insert(schema.appSettings).values({
      key: "ai",
      value: { provider: "anthropic", baseUrl: null, model: "m", apiKeySealed: "bad.sealed.value", apiKeyHint: "…xxxx", timeoutMs: 45000 },
    });
    settings.invalidateSettingsCache();
    const ai = await settings.resolveAi();
    expect(ai.configured).toBe(false);
    expect(ai.problem).toMatch(/无法解密/);

    const ids = (await createFixturePlaces()).places;
    const visitorId = (await createGuestSession()).visitor.id;
    const up = await uploadPhoto({ visitorId, bytes: await solidJpeg("#c7372f") });
    await expect(
      attempts.createPhotoAttempt({ visitorId, placeId: ids["test-gate"]!, assetId: up.assetId, position: null, questRunId: null, questStepId: null, clientIp: null }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("clearing returns to the environment configuration", async () => {
    await settings.saveAiSettings(owner, input());
    await settings.clearSettings(owner, "ai");
    expect((await settings.resolveAi()).source).toBe("env");
  });

  it("test connection sends a real request with an image and logs it", async () => {
    seen.length = 0;
    const ok = await testAiSettings(owner, input());
    expect(ok).toMatchObject({ ok: true, model: "vision-a" });
    expect(seen[0]).toMatchObject({ auth: `Bearer ${KEY}`, model: "vision-a", hasImage: true });

    const bad = await testAiSettings(owner, input({ apiKey: "sk-wrong-key-000000" }));
    expect(bad).toMatchObject({ ok: false, code: "AI_AUTH" });

    const calls = await db().select().from(schema.aiCalls);
    expect(calls.map((c) => `${c.stage}:${c.status}`).sort()).toEqual(["test:failed", "test:succeeded"]);
    // Testing never saves.
    expect(await db().select().from(schema.appSettings)).toHaveLength(0);
  });
});

describe("map settings", () => {
  it("builds a MapTiler style URL and clears back to the environment", async () => {
    expect((await settings.resolveMap()).configured).toBe(false);
    await settings.saveMapSettings(owner, settings.mapSettingsInputSchema.parse({ apiKey: "AbCdEf123456", style: "basic-v2" }));
    expect(await settings.resolveMap()).toEqual({
      source: "settings",
      configured: true,
      styleUrl: "https://api.maptiler.com/maps/basic-v2/style.json?key=AbCdEf123456",
    });
    await settings.clearSettings(owner, "map");
    expect((await settings.resolveMap()).configured).toBe(false);
  });

  it("rejects keys that could break out of the URL", () => {
    expect(() => settings.mapSettingsInputSchema.parse({ apiKey: "abc&style=evil123" })).toThrow();
  });
});
