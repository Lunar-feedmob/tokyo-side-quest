import { resumeQuestRun } from "@tsq/core/services/quests";
import { idempotent, requireVisitor, route } from "@/lib/server/api";

export const POST = route<{ id: string }>(async (ctx) => {
  const visitor = await requireVisitor({ write: true });
  return idempotent(ctx, visitor.id, "quest-runs/resume", { id: ctx.params.id }, async () => ({
    status: 200,
    data: await resumeQuestRun({ visitorId: visitor.id, runId: ctx.params.id }),
  }));
});
