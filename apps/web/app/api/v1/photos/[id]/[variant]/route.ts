import { AppError } from "@tsq/core/http/errors";
import { readOwnPhoto } from "@tsq/core/services/photos";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route<{ id: string; variant: string }>(async ({ params }) => {
  if (params.variant !== "thumb" && params.variant !== "main") throw new AppError("NOT_FOUND", "没有找到这张照片");
  const visitor = await requireVisitor();
  const photo = await readOwnPhoto({ visitorId: visitor.id, assetId: params.id, variant: params.variant });
  return new Response(new Uint8Array(photo.bytes), { headers: { "content-type": photo.mime, "cache-control": "private, no-store" } });
});
