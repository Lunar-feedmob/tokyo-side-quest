import { getAttemptView } from "@tsq/core/services/attempts";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ params }) => {
  const visitor = await requireVisitor();
  return { data: await getAttemptView({ visitorId: visitor.id, attemptId: params.id }) };
});
