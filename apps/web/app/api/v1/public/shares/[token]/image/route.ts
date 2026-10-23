import { readPublicShareImage } from "@tsq/core/services/posters";
import { route } from "@/lib/server/api";

// No long-lived caching: a revoked link must stop serving immediately (spec §14.2).
export const GET = route<{ token: string }>(async ({ params }) => {
  const png = await readPublicShareImage(params.token);
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
});
