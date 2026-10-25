import { cookies } from "next/headers";
import { requestVisitorDeletion } from "@tsq/core/services/deletion";
import { SESSION_COOKIE } from "@tsq/core/services/session";
import { requireVisitor, route } from "@/lib/server/api";

export const DELETE = route(async () => {
  const visitor = await requireVisitor();
  const r = await requestVisitorDeletion(visitor.id);
  // The browser forgets this identity immediately; server-side cleanup continues in the worker.
  (await cookies()).delete(SESSION_COOKIE);
  return { status: 202, data: r };
});
