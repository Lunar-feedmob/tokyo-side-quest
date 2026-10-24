import { testConnection, type ConnectionTestResult } from "../ai";
import { RATING_PROMPT_VERSION } from "../ai/prompts";
import { db } from "../db/client";
import { aiCalls } from "../db/schema";
import { enforceRateLimit } from "../infra/rate-limit";
import { audit, type AdminPrincipal } from "./admin-auth";
import { draftAi, type AiSettingsInput } from "./settings";

/**
 * "Test connection" in the admin console, for the values in the form (saved or
 * not). It is a real, billable model request, so it is rate limited and logged
 * in ai_calls like any other call.
 */
export async function testAiSettings(admin: AdminPrincipal, input: AiSettingsInput): Promise<ConnectionTestResult> {
  await enforceRateLimit({ bucket: "ai-settings-test", subject: admin.id, limit: 20, windowSeconds: 3600, message: "测试太频繁，请稍后再试" });
  const d = await draftAi(input);
  const result = await testConnection(d);
  await db().insert(aiCalls).values({
    stage: "test",
    provider: d.provider,
    model: result.model ?? d.model,
    modelConfigVersion: "settings-test",
    promptVersion: RATING_PROMPT_VERSION,
    status: result.ok ? "succeeded" : "failed",
    errorCode: result.code,
    errorDetail: result.ok ? null : result.message,
    latencyMs: result.latencyMs,
    usage: result.usage,
  });
  await audit({
    actorType: "admin",
    actorId: admin.id,
    action: "settings.ai.test",
    targetType: "settings",
    targetId: "ai",
    meta: { provider: d.provider, model: d.model, baseUrl: d.baseUrl, ok: result.ok, code: result.code },
  });
  return result;
}
