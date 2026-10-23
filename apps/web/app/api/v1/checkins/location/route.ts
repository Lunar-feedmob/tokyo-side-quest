import { locationCheckinRequestSchema } from "@tsq/core/contracts/api";
import { capabilities } from "@tsq/core/config/env";
import { locationCheckin } from "@tsq/core/services/checkins";
import { assertWritable } from "@tsq/core/services/session";
import { ensureVisitor, idempotent, readJson, route } from "@/lib/server/api";

export const POST = route(async (ctx) => {
  
  const body = await readJson(ctx.req, locationCheckinRequestSchema);
  const { visitor } = await ensureVisitor();
  assertWritable(visitor);
  // Simulated readings only in an explicitly enabled test environment (header set by the dev tool).
  const simulated = capabilities().simulatedLocation && ctx.req.headers.get("x-tsq-simulated-location") === "1";
  return idempotent(ctx, visitor.id, "live:checkins/location", body, async () => {
    const result = await locationCheckin({ visitorId: visitor.id, mode: "live", simulated, ...body });
    return { status: 201, data: result };
  });
});
