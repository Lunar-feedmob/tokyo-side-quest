import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { AppError } from "../http/errors";
import { seal, sha256Hex, unseal } from "../security/tokens";
import { audit, type AdminPrincipal } from "./admin-auth";

// Runtime settings edited by an owner in the admin console. Saved settings
// take precedence over the environment; with nothing saved the .env values
// apply, so tests and env-only deployments behave as before.
//
// The AI key is sealed (AES-256-GCM, key derived from SESSION_SECRET) and is
// never returned to the browser or written to logs. The map key is a public
// client key: it ends up in every visitor's style URL by design.

export type AiProviderName = "anthropic" | "openai-compatible";

const storedAiSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]),
  baseUrl: z.string().nullable(),
  model: z.string(),
  apiKeySealed: z.string(),
  apiKeyHint: z.string(),
  timeoutMs: z.number().int(),
});
type StoredAi = z.infer<typeof storedAiSchema>;

const storedMapSchema = z.object({
  provider: z.literal("maptiler"),
  apiKey: z.string(),
  style: z.string(),
});
type StoredMap = z.infer<typeof storedMapSchema>;

interface Snapshot {
  ai: { value: StoredAi; updatedAt: Date } | null;
  map: { value: StoredMap; updatedAt: Date } | null;
}

// Web and worker are separate processes; a short TTL lets the worker pick up
// a change without a restart. The process that saves invalidates at once.
const CACHE_TTL_MS = 10_000;
const cache = globalThis as unknown as { tsqSettings?: { at: number; snapshot: Snapshot } };

export function invalidateSettingsCache(): void {
  cache.tsqSettings = undefined;
}

async function snapshot(): Promise<Snapshot> {
  const hit = cache.tsqSettings;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snapshot;
  const s: Snapshot = { ai: null, map: null };
  try {
    const rows = await db().select().from(appSettings).where(inArray(appSettings.key, ["ai", "map"]));
    for (const row of rows) {
      if (row.key === "ai") {
        const parsed = storedAiSchema.safeParse(row.value);
        if (parsed.success) s.ai = { value: parsed.data, updatedAt: row.updatedAt };
      } else if (row.key === "map") {
        const parsed = storedMapSchema.safeParse(row.value);
        if (parsed.success) s.map = { value: parsed.data, updatedAt: row.updatedAt };
      }
    }
  } catch (error) {
    // Unreadable settings must not take the site down; fall back to the environment.
    console.error(JSON.stringify({ level: "error", msg: "settings unavailable", error: error instanceof Error ? error.message : String(error) }));
  }
  cache.tsqSettings = { at: Date.now(), snapshot: s };
  return s;
}

// ── AI ──────────────────────────────────────────────────────────────────────

export interface ResolvedAi {
  source: "settings" | "env" | "none";
  configured: boolean;
  provider: AiProviderName | "fake" | null;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
  /** Part of the evaluation cache key: changing provider, endpoint or model yields new evaluations. */
  modelConfigVersion: string;
  missing: string[];
  /** Human-readable reason when saved settings exist but cannot be used. */
  problem: string | null;
}

function settingsConfigVersion(provider: string, baseUrl: string | null, model: string): string {
  return `${env().AI_MODEL_CONFIG_VERSION}+s${sha256Hex(provider, baseUrl ?? "", model).slice(0, 8)}`;
}

function resolveFromEnv(): ResolvedAi {
  const e = env();
  const missing: string[] = [];
  if (!e.AI_PROVIDER) missing.push("AI_PROVIDER");
  if (e.AI_PROVIDER && e.AI_PROVIDER !== "fake") {
    if (!e.AI_API_KEY) missing.push("AI_API_KEY");
    if (!e.AI_VISION_MODEL) missing.push("AI_VISION_MODEL");
    if (e.AI_PROVIDER === "openai-compatible" && !e.AI_API_BASE_URL) missing.push("AI_API_BASE_URL");
  }
  return {
    source: e.AI_PROVIDER ? "env" : "none",
    configured: missing.length === 0,
    provider: e.AI_PROVIDER ?? null,
    model: e.AI_PROVIDER === "fake" ? "fake-vision-1" : (e.AI_VISION_MODEL ?? null),
    baseUrl: e.AI_API_BASE_URL ?? null,
    apiKey: e.AI_API_KEY ?? null,
    timeoutMs: e.AI_TIMEOUT_MS,
    modelConfigVersion: e.AI_MODEL_CONFIG_VERSION,
    missing,
    problem: null,
  };
}

function resolveStoredAi(stored: StoredAi): ResolvedAi {
  let apiKey: string | null = null;
  let problem: string | null = null;
  try {
    apiKey = unseal(stored.apiKeySealed);
  } catch {
    problem = "已保存的 API Key 无法解密（SESSION_SECRET 可能已更换），请在后台重新填写";
  }
  return {
    source: "settings",
    configured: apiKey !== null,
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl,
    apiKey,
    timeoutMs: stored.timeoutMs,
    modelConfigVersion: settingsConfigVersion(stored.provider, stored.baseUrl, stored.model),
    missing: apiKey ? [] : ["API Key"],
    problem,
  };
}

/** The AI configuration in effect right now: admin settings first, then the environment. */
export async function resolveAi(): Promise<ResolvedAi> {
  const s = await snapshot();
  return s.ai ? resolveStoredAi(s.ai.value) : resolveFromEnv();
}

const optionalTrimmed = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined));

export const aiSettingsInputSchema = z
  .object({
    provider: z.enum(["anthropic", "openai-compatible"]),
    baseUrl: optionalTrimmed,
    model: z.string().trim().min(1, "请填写模型名称").max(200),
    /** Empty keeps the key already saved. */
    apiKey: optionalTrimmed,
    timeoutMs: z.coerce.number().int().min(5_000).max(300_000).default(45_000),
  })
  .superRefine((v, ctx) => {
    if (v.provider === "openai-compatible" && !v.baseUrl) {
      ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "OpenAI 兼容协议需要填写接口地址（通常以 /v1 结尾）" });
    }
    if (v.baseUrl) {
      let url: URL | null = null;
      try {
        url = new URL(v.baseUrl);
      } catch {
        // reported below
      }
      if (!url || !["http:", "https:"].includes(url.protocol)) {
        ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "接口地址必须是 http(s) 网址" });
      } else if (url.protocol === "http:" && env().APP_ENV === "production") {
        ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "生产环境的接口地址必须使用 https" });
      }
    }
  });
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

function keyHint(key: string): string {
  return key.length <= 8 ? "已设置" : `…${key.slice(-4)}`;
}

/**
 * Turns a form submission into a usable configuration, taking the saved key
 * when the form leaves it blank. Used for both saving and "test connection".
 */
export async function draftAi(input: AiSettingsInput): Promise<{ provider: AiProviderName; baseUrl: string | null; model: string; apiKey: string; timeoutMs: number }> {
  let apiKey = input.apiKey ?? null;
  if (!apiKey) {
    invalidateSettingsCache();
    const saved = (await snapshot()).ai;
    if (saved) {
      try {
        apiKey = unseal(saved.value.apiKeySealed);
      } catch {
        apiKey = null;
      }
    }
  }
  if (!apiKey) throw new AppError("VALIDATION_ERROR", "请填写 API Key");
  return {
    provider: input.provider,
    baseUrl: input.baseUrl ? input.baseUrl.replace(/\/+$/, "") : null,
    model: input.model,
    apiKey,
    timeoutMs: input.timeoutMs,
  };
}

async function upsert(key: "ai" | "map", value: Record<string, unknown>, adminId: string) {
  await db()
    .insert(appSettings)
    .values({ key, value, updatedBy: adminId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: adminId, updatedAt: sql`now()` } });
  invalidateSettingsCache();
}

export async function saveAiSettings(admin: AdminPrincipal, input: AiSettingsInput) {
  const d = await draftAi(input);
  const stored: StoredAi = {
    provider: d.provider,
    baseUrl: d.baseUrl,
    model: d.model,
    apiKeySealed: seal(d.apiKey),
    apiKeyHint: keyHint(d.apiKey),
    timeoutMs: d.timeoutMs,
  };
  await upsert("ai", stored, admin.id);
  await audit({
    actorType: "admin",
    actorId: admin.id,
    action: "settings.ai.save",
    targetType: "settings",
    targetId: "ai",
    // Never the key itself.
    meta: { provider: d.provider, model: d.model, baseUrl: d.baseUrl, keyChanged: Boolean(input.apiKey), timeoutMs: d.timeoutMs },
  });
  return adminSettingsView();
}

// ── Map ─────────────────────────────────────────────────────────────────────

export interface ResolvedMap {
  source: "settings" | "env" | "none";
  configured: boolean;
  styleUrl: string | null;
}

export const MAPTILER_STYLES = ["streets-v2", "basic-v2", "bright-v2", "dataviz", "topo-v2"] as const;

function maptilerStyleUrl(m: StoredMap): string {
  return `https://api.maptiler.com/maps/${encodeURIComponent(m.style)}/style.json?key=${encodeURIComponent(m.apiKey)}`;
}

export async function resolveMap(): Promise<ResolvedMap> {
  const saved = (await snapshot()).map;
  if (saved) return { source: "settings", configured: true, styleUrl: maptilerStyleUrl(saved.value) };
  const url = env().MAP_STYLE_URL ?? null;
  return { source: url ? "env" : "none", configured: Boolean(url), styleUrl: url };
}

export const mapSettingsInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, "请填写 MapTiler API Key")
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "API Key 只应包含字母、数字、- 和 _"),
  style: z.enum(MAPTILER_STYLES).default("streets-v2"),
});

export async function saveMapSettings(admin: AdminPrincipal, input: z.infer<typeof mapSettingsInputSchema>) {
  const stored: StoredMap = { provider: "maptiler", apiKey: input.apiKey, style: input.style };
  await upsert("map", stored, admin.id);
  await audit({ actorType: "admin", actorId: admin.id, action: "settings.map.save", targetType: "settings", targetId: "map", meta: { provider: "maptiler", style: input.style } });
  return adminSettingsView();
}

// ── Shared ──────────────────────────────────────────────────────────────────

export async function clearSettings(admin: AdminPrincipal, key: "ai" | "map") {
  await db().delete(appSettings).where(inArray(appSettings.key, [key]));
  invalidateSettingsCache();
  await audit({ actorType: "admin", actorId: admin.id, action: `settings.${key}.clear`, targetType: "settings", targetId: key });
  return adminSettingsView();
}

/** What the owner sees in the console. Contains no AI key, only a hint of its last characters. */
export async function adminSettingsView() {
  invalidateSettingsCache();
  const s = await snapshot();
  const ai = s.ai ? resolveStoredAi(s.ai.value) : resolveFromEnv();
  const envAi = resolveFromEnv();
  const map = await resolveMap();
  return {
    ai: {
      effective: {
        source: ai.source,
        configured: ai.configured,
        provider: ai.provider,
        model: ai.model,
        baseUrl: ai.baseUrl,
        missing: ai.missing,
        problem: ai.problem,
      },
      saved: s.ai
        ? {
            provider: s.ai.value.provider,
            baseUrl: s.ai.value.baseUrl,
            model: s.ai.value.model,
            timeoutMs: s.ai.value.timeoutMs,
            apiKeyHint: s.ai.value.apiKeyHint,
            updatedAt: s.ai.updatedAt.toISOString(),
          }
        : null,
      env: { configured: envAi.configured, provider: envAi.provider, model: envAi.model },
    },
    map: {
      effective: { source: map.source, configured: map.configured },
      saved: s.map ? { provider: s.map.value.provider, style: s.map.value.style, apiKey: s.map.value.apiKey, updatedAt: s.map.updatedAt.toISOString() } : null,
      styles: MAPTILER_STYLES,
    },
  };
}
