import { locationCheckinRequestSchema } from "@tsq/core/contracts/api";
import { locationCheckin } from "@tsq/core/services/checkins";
import { assertWritable } from "@tsq/core/services/session";
import { ensureVisitor, idempotent, readJson, route } from "@/lib/server/api";
import { demoGuard } from "@/lib/server/demo";
export const POST = route(async (ctx) => {
  demoGuard();
  const body = await readJson(ctx.req, locationCheckinRequestSchema);
  const { visitor } = await ensureVisitor();
  assertWritable(visitor);
  // Demo positions are always simulated and labelled.
  const simulated = true;
  return idempotent(ctx, visitor.id, "demo:checkins/location", body, async () => {
    const result = await locationCheckin({ visitorId: visitor.id, mode: "demo", simulated, ...body });
    return { status: 201, data: result };
  });
});
