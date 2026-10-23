import { listShares } from "@tsq/core/services/posters";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route(async () => {
  const visitor = await requireVisitor();
  return { data: { items: await listShares(visitor.id) } };
});
