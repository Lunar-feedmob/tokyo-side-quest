import { listQuests } from "@tsq/core/services/quests";
import { route } from "@/lib/server/api";

export const GET = route(async () => ({ data: { items: await listQuests() } }));
