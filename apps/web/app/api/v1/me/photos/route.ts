import { myPhotos } from "@tsq/core/services/me";
import { modeParam, requireVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const visitor = await requireVisitor();
  const sp = req.nextUrl.searchParams;
  return { data: await myPhotos(visitor.id, modeParam(req), Number(sp.get("limit") ?? 50), Number(sp.get("offset") ?? 0)) };
});
