import { z } from "zod";

// Server-side configuration. Optional integrations (AI, map, storage) are
// reported as capabilities so the UI can degrade honestly instead of faking.

const boolFromString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Separate from NODE_ENV: `next start` always runs with NODE_ENV=production,
  // but e2e runs need an explicitly labelled test deployment.
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 至少 32 个字符"),

  STORAGE_ENDPOINT: optionalString,
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY_ID: optionalString,
  STORAGE_SECRET_ACCESS_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),

  MAP_STYLE_URL: optionalString,
  MAP_PUBLIC_TOKEN: optionalString,

  AI_PROVIDER: z
    .enum(["anthropic", "openai-compatible", "fake", ""])
    .optional()
    .transform((v) => (v ? v : undefined)),
  AI_API_BASE_URL: optionalString,
  AI_API_KEY: optionalString,
  AI_VISION_MODEL: optionalString,
  AI_MODEL_CONFIG_VERSION: z.string().default("model-config-1"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),

  DEMO_ENABLED: z.enum(["true", "false"]).default("true"),
  DEV_SIMULATED_LOCATION: boolFromString,
  LOCATION_RAW_RETENTION_HOURS: z.coerce.number().int().min(1).default(24),
  SHARE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  PHOTO_ATTEMPTS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  PHOTO_ATTEMPTS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(60),
  TRUST_PROXY: boolFromString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`环境变量配置无效：${issues}`);
    }
    cached = parsed.data;
    if (cached.AI_PROVIDER === "fake" && cached.APP_ENV !== "test") {
      throw new Error("AI_PROVIDER=fake 只允许在测试环境使用");
    }
    if (cached.DEV_SIMULATED_LOCATION && cached.APP_ENV === "production") {
      throw new Error("DEV_SIMULATED_LOCATION 不能在生产环境启用");
    }
  }
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}

export interface Capabilities {
  storage: { configured: boolean; missing: string[] };
  demo: boolean;
  simulatedLocation: boolean;
  testEnvironment: boolean;
}

/**
 * Environment-only capabilities. AI and map can also be configured in the admin
 * console, so they are resolved asynchronously by services/settings
 * (resolveAi / resolveMap) rather than here.
 */
export function capabilities(e: Env = env()): Capabilities {
  const storageMissing = (
    ["STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"] as const
  ).filter((k) => !e[k]);
  return {
    storage: { configured: storageMissing.length === 0, missing: storageMissing },
    demo: e.DEMO_ENABLED === "true",
    simulatedLocation: e.DEV_SIMULATED_LOCATION && e.APP_ENV !== "production",
    testEnvironment: e.APP_ENV === "test",
  };
}
