import { aiQuotaStatus } from "@tsq/core/services/ai-quota";
import { clearSettings, quotaSettingsInputSchema, saveQuotaSettings } from "@tsq/core/services/settings";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Daily AI call budget: today's usage, and the owner-set limit.
export const GET = route(async () => {
  await requireAdmin("owner");
  return { data: await aiQuotaStatus() };
});

export const POST = route(async ({ req }) => {
  const admin = await requireAdmin("owner");
  const body = await readJson(req, quotaSettingsInputSchema);
  return { data: await saveQuotaSettings(admin, body) };
});

export const DELETE = route(async () => {
  const admin = await requireAdmin("owner");
  return { data: await clearSettings(admin, "quota") };
});
