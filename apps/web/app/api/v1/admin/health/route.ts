import { readiness } from "@/lib/server/readiness";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Detailed configuration gaps are for admins only (spec §16.3).
export const GET = route(async () => {
  await requireAdmin("content");
  const { capabilities } = await import("@tsq/core/config/env");
  const { resolveAi } = await import("@tsq/core/services/settings");
  const ai = await resolveAi();
  return {
    data: {
      ...(await readiness()),
      missing: { ai: ai.problem ? [ai.problem] : ai.missing, storage: capabilities().storage.missing },
    },
  };
});
