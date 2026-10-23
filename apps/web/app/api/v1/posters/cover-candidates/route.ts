import { coverCandidates, questPlaceIds } from "@tsq/core/services/posters";
import { modeParam, requireVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const visitor = await requireVisitor();
  const sp = req.nextUrl.searchParams;
  const run = sp.get("run");
  const place = sp.get("place");
  const placeIds = run ? await questPlaceIds(run) : place ? [place] : undefined;
  return { data: { items: await coverCandidates({ visitorId: visitor.id, mode: modeParam(req), placeIds }) } };
});
