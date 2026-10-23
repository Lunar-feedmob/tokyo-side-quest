import { readPosterImage } from "@tsq/core/services/posters";
import { requireVisitor, route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ req, params }) => {
  const visitor = await requireVisitor();
  const png = await readPosterImage({ visitorId: visitor.id, posterId: params.id });
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      ...(download ? { "content-disposition": `attachment; filename="tokyo-side-quest-ticket.png"` } : {}),
    },
  });
});
