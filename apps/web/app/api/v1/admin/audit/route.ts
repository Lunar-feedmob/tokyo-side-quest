import { adminAuditLog } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route(async () => {
  await requireAdmin("owner");
  return { data: { items: await adminAuditLog() } };
});
