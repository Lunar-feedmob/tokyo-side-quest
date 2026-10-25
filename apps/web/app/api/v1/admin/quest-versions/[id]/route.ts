import { adminQuestVersion } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route<{ id: string }>(async ({ params }) => {
  await requireAdmin("content");
  return { data: await adminQuestVersion(params.id) };
});
