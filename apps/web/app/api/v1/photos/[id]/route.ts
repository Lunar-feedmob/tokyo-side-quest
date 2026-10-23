import { requestPhotoDeletion } from "@tsq/core/services/deletion";
import { requireVisitor, route } from "@/lib/server/api";

export const DELETE = route<{ id: string }>(async ({ params }) => {
  const visitor = await requireVisitor();
  return { status: 202, data: await requestPhotoDeletion({ visitorId: visitor.id, assetId: params.id }) };
});
