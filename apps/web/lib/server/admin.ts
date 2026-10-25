import "server-only";
import { cookies } from "next/headers";
import { AppError } from "@tsq/core/http/errors";
import { ADMIN_COOKIE, adminFromToken, assertRole, type AdminPrincipal } from "@tsq/core/services/admin-auth";

// Admin identity comes only from the admin cookie, verified server-side on
// every call (spec §4.8). The visitor cookie is never consulted here.
export async function requireAdmin(needed: "review" | "content" | "owner" = "review"): Promise<AdminPrincipal> {
  const admin = await adminFromToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) throw new AppError("UNAUTHENTICATED", "需要管理员登录");
  assertRole(admin, needed);
  return admin;
}
