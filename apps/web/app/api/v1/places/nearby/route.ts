import { nearbyRequestSchema } from "@tsq/core/contracts/api";
import { nearbyPlaces } from "@tsq/core/services/places";
import { modeParam, optionalVisitor, readJson, route } from "@/lib/server/api";

// POST so coordinates never appear in URLs or access logs (spec §10.1).
export const POST = route(async ({ req }) => {
  const body = await readJson(req, nearbyRequestSchema);
  const visitor = await optionalVisitor();
  const items = await nearbyPlaces({ ...body, visitorId: visitor?.id ?? null, mode: modeParam(req) });
  return { data: { items, radiusMeters: body.radiusMeters, distanceType: "straight_line" } };
}, { write: false });
