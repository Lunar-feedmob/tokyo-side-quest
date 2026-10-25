import { adminReviewDecisionSchema } from "@tsq/core/contracts/api";
import { decideReview } from "@tsq/core/services/admin";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const POST = route<{ id: string }>(async ({ req, params }) => {
  const admin = await requireAdmin("review");
  const body = await readJson(req, adminReviewDecisionSchema);
  return { data: await decideReview(admin, params.id, body.decision, body.reason) };
});
