import { retryPoster } from "@tsq/core/services/posters";
import { idempotent, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "posters/retry", { id: ctx.params.id }, async () => ({
    status: 202,
    data: await retryPoster({ visitorId: visitor.id, posterId: ctx.params.id }),
  }));
});
