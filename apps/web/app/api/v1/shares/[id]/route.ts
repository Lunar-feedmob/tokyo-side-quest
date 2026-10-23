import { revokeShare } from "@tsq/core/services/posters";
import { requireVisitor, route } from "@/lib/server/api";

export const DELETE = route<{ id: string }>(async ({ params }) => {
  const visitor = await requireVisitor({ write: true });
  await revokeShare({ visitorId: visitor.id, shareId: params.id });
  return { status: 204, data: null };
});
