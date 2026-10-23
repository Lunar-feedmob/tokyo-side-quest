import { retryAttempt } from "@tsq/core/services/attempts";
import { idempotent, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "photo-attempts/retry", { id: ctx.params.id }, async () => ({
    status: 202,
    data: await retryAttempt({ visitorId: visitor.id, attemptId: ctx.params.id }),
  }));
});
