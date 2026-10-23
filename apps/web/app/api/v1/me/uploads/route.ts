import { myDeletablePhotos } from "@tsq/core/services/deletion";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route(async () => {
  const visitor = await requireVisitor();
  const items = await myDeletablePhotos(visitor.id);
  return { data: { items: items.map((i) => ({ ...i, thumbUrl: i.state === "ready" ? `/api/v1/photos/${i.assetId}/thumb` : null })) } };
});
