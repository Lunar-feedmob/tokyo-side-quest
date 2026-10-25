import { getQuest } from "@tsq/core/services/quests";
import { route } from "@/lib/server/api";

export const GET = route<{ id: string }>(async ({ params }) => ({ data: await getQuest(params.id) }));
