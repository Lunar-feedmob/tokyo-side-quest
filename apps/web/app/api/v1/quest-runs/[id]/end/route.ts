import { endQuestRun } from "@tsq/core/services/quests";
import { idempotent, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "quest-runs/end", { id: ctx.params.id }, async () => ({
    status: 200,
    data: await endQuestRun({ visitorId: visitor.id, runId: ctx.params.id }),
  }));
});
