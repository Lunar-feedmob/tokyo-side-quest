import { getPoster } from "@tsq/core/services/posters";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ params }) => {
  const visitor = await requireVisitor();
  return { data: await getPoster({ visitorId: visitor.id, posterId: params.id }) };
});
