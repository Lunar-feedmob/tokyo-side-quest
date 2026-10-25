import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client";
import { adminSessions, admins, auditLogs } from "../db/schema";
import { AppError } from "../http/errors";
import { enforceRateLimit } from "../infra/rate-limit";
import { hashToken, randomToken } from "../security/tokens";

// Admin authentication (spec §4.8). Separate cookie and session table from
// visitors; a visitor session can never become an admin session. Passwords
// are hashed with Argon2id (@node-rs/argon2).

export const ADMIN_COOKIE = "tsq_admin";
export const ADMIN_SESSION_HOURS = 12;
export const ADMIN_ROLES = ["owner", "editor", "reviewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
// Verified when the username does not exist, so timing does not reveal valid names.
let dummyHash: Promise<string> | null = null;

export function validatePassword(password: string): string | null {
  if (password.length < 12) return "密码至少 12 个字符";
  if (password.length > 256) return "密码过长";
  return null;
}

export async function createAdmin(opts: { username: string; password: string; role: AdminRole }) {
  const username = opts.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/u.test(username)) throw new AppError("VALIDATION_ERROR", "用户名只能包含小写字母、数字、点、下划线和短横线，3–40 位");
  const problem = validatePassword(opts.password);
  if (problem) throw new AppError("VALIDATION_ERROR", problem);
  const passwordHash = await hash(opts.password, ARGON);
  const [row] = await db()
    .insert(admins)
    .values({ username, passwordHash, role: opts.role })
    .onConflictDoNothing()
    .returning({ id: admins.id });
  if (!row) throw new AppError("QUEST_RUN_CONFLICT", "这个用户名已存在");
  await audit({ actorType: "system", actorId: null, action: "admin.create", targetType: "admin", targetId: row.id, meta: { role: opts.role } });
  return { id: row.id, username };
}

export async function adminLogin(opts: { username: string; password: string; clientKey: string }) {
  const username = opts.username.trim().toLowerCase();
  // Throttle by client and by account; failures are counted before verifying.
  await enforceRateLimit({ bucket: "admin-login-client", subject: opts.clientKey, limit: 10, windowSeconds: 900, message: "登录尝试过多，请 15 分钟后再试" });
  await enforceRateLimit({ bucket: "admin-login-user", subject: username || "-", limit: 10, windowSeconds: 900, message: "登录尝试过多，请 15 分钟后再试" });

  const [admin] = await db().select().from(admins).where(eq(admins.username, username)).limit(1);
  dummyHash ??= hash("not-a-real-password-for-timing", ARGON);
  const ok = await verify(admin?.passwordHash ?? (await dummyHash), opts.password).catch(() => false);
  if (!admin || !ok || admin.status !== "active") {
    await audit({ actorType: "system", actorId: null, action: "admin.login_failed", targetType: "admin", targetId: admin?.id ?? null, meta: {} });
    throw new AppError("UNAUTHENTICATED", "用户名或密码不正确");
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_HOURS * 3_600_000);
  await db().insert(adminSessions).values({ tokenHash: hashToken(token), adminId: admin.id, expiresAt });
  await db().update(admins).set({ lastLoginAt: new Date() }).where(eq(admins.id, admin.id));
  await audit({ actorType: "admin", actorId: admin.id, action: "admin.login", targetType: "admin", targetId: admin.id });
  return { token, expiresAt, admin: { id: admin.id, username: admin.username, role: admin.role as AdminRole } };
}

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
}

export async function adminFromToken(token: string | undefined | null): Promise<AdminPrincipal | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db()
    .select({ id: admins.id, username: admins.username, role: admins.role, status: admins.status })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.status !== "active") return null;
  return { id: row.id, username: row.username, role: row.role as AdminRole };
}

export async function adminLogout(token: string) {
  await db().delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

const ROLE_RANK: Record<AdminRole, number> = { reviewer: 1, editor: 2, owner: 3 };

/** reviewer: reviews only · editor: content + reviews · owner: everything. */
export function assertRole(admin: AdminPrincipal, needed: "review" | "content" | "owner") {
  const min = needed === "review" ? 1 : needed === "content" ? 2 : 3;
  if (ROLE_RANK[admin.role] < min) throw new AppError("FORBIDDEN", "当前管理员角色没有这项权限");
}

/** Audit entries never contain secrets, images or precise coordinates (spec §15). */
export async function audit(entry: {
  actorType: "admin" | "visitor" | "system";
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db()
    .insert(auditLogs)
    .values({
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason ?? null,
      meta: entry.meta ?? null,
    });
}
