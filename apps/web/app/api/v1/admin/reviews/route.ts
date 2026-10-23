import { listReviews } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route(async ({ req }) => {
  await requireAdmin("review");
  const s = req.nextUrl.searchParams.get("status");
  const status = s === "approved" || s === "rejected" ? s : "open";
  return { data: { items: await listReviews(status) } };
});
