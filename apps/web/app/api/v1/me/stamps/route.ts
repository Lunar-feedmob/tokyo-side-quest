import { myStamps } from "@tsq/core/services/me";
import { modeParam, requireVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const visitor = await requireVisitor();
  return { data: { items: await myStamps(visitor.id, modeParam(req)) } };
});
