import { listNeighborhoods } from "@tsq/core/services/places";
import { route } from "@/lib/server/api";

export const GET = route(async () => ({ data: { items: await listNeighborhoods() } }));
