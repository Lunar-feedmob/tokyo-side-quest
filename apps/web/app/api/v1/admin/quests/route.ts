import { adminListQuests } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route(async () => {
  await requireAdmin("content");
  return { data: { items: await adminListQuests() } };
});
