import { aiSettingsInputSchema, clearSettings, saveAiSettings } from "@tsq/core/services/settings";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const POST = route(async ({ req }) => {
  const admin = await requireAdmin("owner");
  const body = await readJson(req, aiSettingsInputSchema);
  return { data: await saveAiSettings(admin, body) };
});

/** Removes the saved settings; the environment configuration (if any) applies again. */
export const DELETE = route(async () => {
  const admin = await requireAdmin("owner");
  return { data: await clearSettings(admin, "ai") };
});
