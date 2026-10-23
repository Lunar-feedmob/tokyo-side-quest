import { renderPosterPng, SAMPLE_SNAPSHOT } from "@tsq/core/posters/render";
import { route } from "@/lib/server/api";

// Home-page sample ticket rendered by the real poster template (labelled 模板样例).
let cached: Promise<Buffer> | null = null;

export const GET = route(async () => {
  cached ??= renderPosterPng({ snapshot: SAMPLE_SNAPSHOT, coverJpeg: null, shareUrl: null, sample: true }).catch((e) => {
    cached = null;
    throw e;
  });
  const png = await cached;
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
});
