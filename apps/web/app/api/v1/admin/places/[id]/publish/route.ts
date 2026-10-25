import { adminPublishPlace } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const POST = route<{ id: string }>(async ({ params }) => {
  const admin = await requireAdmin("content");
  return { data: await adminPublishPlace(admin, params.id) };
});
