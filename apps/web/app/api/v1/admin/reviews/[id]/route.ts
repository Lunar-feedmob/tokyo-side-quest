import { getReview } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route<{ id: string }>(async ({ params }) => {
  await requireAdmin("review");
  return { data: await getReview(params.id) };
});
