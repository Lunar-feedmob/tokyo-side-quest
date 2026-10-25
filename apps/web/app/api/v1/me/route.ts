import { overview } from "@tsq/core/services/me";
import { modeParam, optionalVisitor, route } from "@/lib/server/api";

export const GET = route(async ({ req }) => {
  const visitor = await optionalVisitor();
  if (!visitor) return { data: { hasVisitor: false } };
  return { data: { hasVisitor: true, deletionRequested: Boolean(visitor.deletionRequestedAt), ...(await overview(visitor.id, modeParam(req))) } };
});
