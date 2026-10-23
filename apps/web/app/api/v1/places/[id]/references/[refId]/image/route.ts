import { and, eq } from "drizzle-orm";
import { db } from "@tsq/core/db/client";
import { assets, referenceImages } from "@tsq/core/db/schema";
import { AppError } from "@tsq/core/http/errors";
import { getObject } from "@tsq/core/storage/s3";
import { route } from "@/lib/server/api";

// Only references whose licence permits public display are served (spec §11.2).
export const GET = route<{ id: string; refId: string }>(async ({ params }) => {
  const [ref] = await db()
    .select({ thumbKey: assets.thumbKey, objectKey: assets.objectKey })
    .from(referenceImages)
    .innerJoin(assets, eq(assets.id, referenceImages.assetId))
    .where(and(eq(referenceImages.id, params.refId), eq(referenceImages.placeId, params.id), eq(referenceImages.publicDisplay, true)))
    .limit(1);
  if (!ref) throw new AppError("NOT_FOUND", "没有找到这张参考图");
  const bytes = await getObject(ref.thumbKey ?? ref.objectKey);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
});
