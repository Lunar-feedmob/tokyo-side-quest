import { getPublicShare } from "@tsq/core/services/posters";
import { route } from "@/lib/server/api";

export const GET = route<{ token: string }>(async ({ params }) => ({ data: await getPublicShare(params.token) }));
