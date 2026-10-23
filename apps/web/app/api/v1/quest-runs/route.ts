import { startQuestRunRequestSchema } from "@tsq/core/contracts/api";
import { startQuestRun } from "@tsq/core/services/quests";
import { assertWritable } from "@tsq/core/services/session";
import { ensureVisitor, idempotent, readJson, route } from "@/lib/server/api";

export const POST = route(async (ctx) => {
  
  const body = await readJson(ctx.req, startQuestRunRequestSchema);
  const { visitor } = await ensureVisitor();
  assertWritable(visitor);
  return idempotent(ctx, visitor.id, "live:quest-runs", body, async () => {
    const run = await startQuestRun({ visitorId: visitor.id, mode: "live", questId: body.questId });
    return { status: run.created ? 201 : 200, data: run };
  });
});
