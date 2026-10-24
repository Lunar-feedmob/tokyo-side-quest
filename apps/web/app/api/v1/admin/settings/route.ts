import { adminSettingsView } from "@tsq/core/services/settings";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Runtime settings (AI provider, map basemap) are owner-only.
export const GET = route(async () => {
  await requireAdmin("owner");
  return { data: await adminSettingsView() };
});
