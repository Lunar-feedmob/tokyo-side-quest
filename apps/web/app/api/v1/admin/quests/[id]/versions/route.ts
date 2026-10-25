import { adminCreateQuestVersion, questVersionSchema } from "@tsq/core/services/admin";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const POST = route<{ id: string }>(async ({ req, params }) => {
  const admin = await requireAdmin("content");
  const body = await readJson(req, questVersionSchema);
  return { status: 201, data: await adminCreateQuestVersion(admin, params.id, body) };
});
