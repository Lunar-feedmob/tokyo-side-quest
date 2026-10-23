import { listPlaces } from "@tsq/core/services/places";
import { modeParam, optionalVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const visitor = await optionalVisitor();
  const page = await listPlaces({
    neighborhoodSlug: sp.get("neighborhood") ?? undefined,
    visitorId: visitor?.id ?? null,
    mode: modeParam(req),
    limit: Number(sp.get("limit") ?? 50),
    offset: Number(sp.get("offset") ?? 0),
  });
  return { data: page };
});
