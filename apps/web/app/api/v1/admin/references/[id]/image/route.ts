import { referenceImageBytes } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const GET = route<{ id: string }>(async ({ params }) => {
  await requireAdmin("review");
  const bytes = await referenceImageBytes(params.id);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
});
