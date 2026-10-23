import { createPosterRequestSchema } from "@tsq/core/contracts/api";
import { createPoster, listPosters } from "@tsq/core/services/posters";
import { idempotent, modeParam, readJson, requireVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const visitor = await requireVisitor();
  return { data: { items: await listPosters(visitor.id, modeParam(req)) } };
});

export const POST = route(async (ctx) => {
  const body = await readJson(ctx.req, createPosterRequestSchema);
  const visitor = await requireVisitor({ write: true });
  const mode = modeParam(ctx.req);
  return idempotent(ctx, visitor.id, `${mode}:posters`, body, async () => ({
    status: 202,
    data: await createPoster({ visitorId: visitor.id, mode, ...body }),
  }));
});
