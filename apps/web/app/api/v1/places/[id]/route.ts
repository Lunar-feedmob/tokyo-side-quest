import { getPlace } from "@tsq/core/services/places";
import { route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ params }) => {
  const place = await getPlace(params.id);
  return {
    data: {
      ...place,
      // Internal-only references are listed by count, not shown.
      references: place.references.filter((r) => r.publicDisplay).map((r) => ({ ...r, imageUrl: `/api/v1/places/${place.id}/references/${r.id}/image` })),
      referenceCount: place.references.length,
    },
  };
});
