import { deleteSurveyEntry } from "@tsq/core/services/survey";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const DELETE = route<{ id: string; entryId: string }>(async ({ params }) => {
  const admin = await requireAdmin("content");
  return { data: await deleteSurveyEntry(admin, params.id, params.entryId) };
});
