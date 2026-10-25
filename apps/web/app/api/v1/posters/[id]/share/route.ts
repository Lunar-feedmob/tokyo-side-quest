import { createShare } from "@tsq/core/services/posters";
import { idempotent, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "posters/share", { id: ctx.params.id }, async () => {
    const r = await createShare({ visitorId: visitor.id, posterId: ctx.params.id });
    return { status: r.created ? 201 : 200, data: r };
  });
});
