import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "@tsq/core/config/env";
import { ADMIN_COOKIE, ADMIN_SESSION_HOURS, adminLogin, adminLogout } from "@tsq/core/services/admin-auth";
import { clientIp, readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(256) }).strict();

export const GET = route(async () => ({ data: { admin: await requireAdmin() } }));

export const POST = route(async ({ req }) => {
  const body = await readJson(req, loginSchema);
  const r = await adminLogin({ ...body, clientKey: clientIp(req) ?? "local" });
  (await cookies()).set(ADMIN_COOKIE, r.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().APP_BASE_URL.startsWith("https://"),
    path: "/",
    expires: r.expiresAt,
    maxAge: ADMIN_SESSION_HOURS * 3600,
  });
  return { data: { admin: r.admin } };
});

export const DELETE = route(async () => {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await adminLogout(token);
  jar.delete(ADMIN_COOKIE);
  return { status: 204, data: null };
});
