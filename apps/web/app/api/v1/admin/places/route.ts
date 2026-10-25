import { adminCreatePlace, adminListPlaces, placeUpsertSchema } from "@tsq/core/services/admin";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route(async () => {
  await requireAdmin("content");
  return { data: { items: await adminListPlaces() } };
});

export const POST = route(async ({ req }) => {
  const admin = await requireAdmin("content");
  const body = await readJson(req, placeUpsertSchema);
  return { status: 201, data: await adminCreatePlace(admin, body) };
});
