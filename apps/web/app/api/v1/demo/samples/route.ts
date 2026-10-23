import { getPlace } from "@tsq/core/services/places";
import { demoSamplesFor } from "@tsq/core/demo/samples";
import { AppError } from "@tsq/core/http/errors";
import { route } from "@/lib/server/api";
import { demoGuard } from "@/lib/server/demo";

export const GET = route(async ({ req }) => {
  demoGuard();
  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId) throw new AppError("VALIDATION_ERROR", "缺少 placeId");
  const place = await getPlace(placeId);
  if (!place.methods.photo) return { data: { items: [] } };
  const items = demoSamplesFor(place.slug, place.content?.distinctiveFeatures[0] ?? "地标").map((s) => ({
    key: s.key,
    label: s.label,
    imageUrl: `/api/v1/demo/samples/${encodeURIComponent(s.key)}/image`,
  }));
  return { data: { items } };
});
