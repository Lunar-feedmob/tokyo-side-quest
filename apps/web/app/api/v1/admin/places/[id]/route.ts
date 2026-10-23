import { adminPatchPlace, adminPlaceDetail, placePatchSchema } from "@tsq/core/services/admin";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route<{ id: string }>(async ({ params }) => {
  await requireAdmin("content");
  return { data: await adminPlaceDetail(params.id) };
});

export const PATCH = route<{ id: string }>(async ({ req, params }) => {
  const admin = await requireAdmin("content");
  const body = await readJson(req, placePatchSchema);
  return { data: await adminPatchPlace(admin, params.id, body) };
});
