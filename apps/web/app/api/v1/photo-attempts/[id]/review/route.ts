import { reviewRequestSchema } from "@tsq/core/contracts/api";
import { requestReview } from "@tsq/core/services/attempts";
import { idempotent, readJson, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const body = await readJson(ctx.req, reviewRequestSchema);
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "photo-attempts/review", { id: ctx.params.id, ...body }, async () => ({
    status: 201,
    data: await requestReview({ visitorId: visitor.id, attemptId: ctx.params.id, note: body.note }),
  }));
});
