import { route } from "@/lib/server/api";

export const GET = route(async () => {
  await Promise.resolve();
  return { data: { status: "alive" } };
});
