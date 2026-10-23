import { adminAiCalls } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route(async ({ req }) => {
  await requireAdmin("content");
  const sp = req.nextUrl.searchParams;
  return { data: await adminAiCalls({ onlyFailed: sp.get("failed") === "1", sinceHours: Math.min(Number(sp.get("hours") ?? 72), 720) }) };
});
