import { readiness } from "@/lib/server/readiness";
import { route } from "@/lib/server/api";

export const GET = route(async () => {
  const r = await readiness();
  return { status: r.ready ? 200 : 503, data: r };
});
