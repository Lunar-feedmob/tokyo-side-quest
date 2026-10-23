import { readiness } from "@/lib/server/readiness";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Detailed configuration gaps are for admins only (spec §16.3).
export const GET = route(async () => {
  await requireAdmin("content");
  const { capabilities } = await import("@tsq/core/config/env");
  return { data: { ...(await readiness()), missing: { ai: capabilities().ai.missing, storage: capabilities().storage.missing } } };
});
