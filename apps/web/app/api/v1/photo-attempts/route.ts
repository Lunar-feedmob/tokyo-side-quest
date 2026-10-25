import { photoAttemptRequestSchema } from "@tsq/core/contracts/api";
import { createPhotoAttempt } from "@tsq/core/services/attempts";
import { clientIp, idempotent, readJson, requireVisitor, route } from "@/lib/server/api";

export const POST = route(async (ctx) => {
  const body = await readJson(ctx.req, photoAttemptRequestSchema);
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "photo-attempts", body, async () => {
    const r = await createPhotoAttempt({ visitorId: visitor.id, clientIp: clientIp(ctx.req), ...body });
    return { status: 202, data: { ...r, statusUrl: `/api/v1/photo-attempts/${r.attemptId}` } };
  });
});
