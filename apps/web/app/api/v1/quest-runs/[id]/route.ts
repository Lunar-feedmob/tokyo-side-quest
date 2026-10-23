import { getQuestRun } from "@tsq/core/services/quests";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ params }) => {
  const visitor = await requireVisitor();
  return { data: await getQuestRun({ visitorId: visitor.id, runId: params.id }) };
});
