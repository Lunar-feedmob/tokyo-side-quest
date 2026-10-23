import { demoPhotoAttemptRequestSchema } from "@tsq/core/contracts/api";
import { createDemoAttempt } from "@tsq/core/services/attempts";
import { assertWritable } from "@tsq/core/services/session";
import { ensureVisitor, idempotent, readJson, route } from "@/lib/server/api";
import { demoGuard } from "@/lib/server/demo";

export const POST = route(async (ctx) => {
  demoGuard();
  const body = await readJson(ctx.req, demoPhotoAttemptRequestSchema);
  const { visitor } = await ensureVisitor();
  assertWritable(visitor);
  return idempotent(ctx, visitor.id, "demo:photo-attempts", body, async () => {
    const r = await createDemoAttempt({ visitorId: visitor.id, ...body });
    return { status: 202, data: { ...r, statusUrl: `/api/v1/photo-attempts/${r.attemptId}` } };
  });
});
