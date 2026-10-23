import { adminRetireReference } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const DELETE = route<{ id: string }>(async ({ params }) => {
  const admin = await requireAdmin("content");
  return { data: await adminRetireReference(admin, params.id) };
});
