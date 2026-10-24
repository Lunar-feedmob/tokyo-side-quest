import { testAiSettings } from "@tsq/core/services/ai-connection";
import { aiSettingsInputSchema } from "@tsq/core/services/settings";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Sends one small real request with the form's values; nothing is saved.
export const POST = route(async ({ req }) => {
  const admin = await requireAdmin("owner");
  const body = await readJson(req, aiSettingsInputSchema);
  return { data: await testAiSettings(admin, body) };
});
