import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, visitors } from "../db/schema";
import { AppError } from "../http/errors";
import { hashToken, randomToken } from "../security/tokens";

// Guest identity (spec §3.5): an unguessable token in an HttpOnly cookie; the
// database only ever sees its keyed hash.

export const SESSION_COOKIE = "tsq_session";
export const SESSION_TTL_DAYS = 180;

export interface Visitor {
  id: string;
  deletionRequestedAt: Date | null;
}

export async function createGuestSession(): Promise<{ token: string; visitor: Visitor; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const visitor = await db().transaction(async (tx) => {
    const [v] = await tx.insert(visitors).values({}).returning({ id: visitors.id });
    await tx.insert(sessions).values({ tokenHash: hashToken(token), visitorId: v!.id, expiresAt });
    return v!;
  });
  return { token, visitor: { id: visitor.id, deletionRequestedAt: null }, expiresAt };
}

export async function visitorFromToken(token: string | undefined | null): Promise<Visitor | null> {
  if (!token || token.length > 128) return null;
  const rows = await db()
    .select({ id: visitors.id, deletionRequestedAt: visitors.deletionRequestedAt })
    .from(sessions)
    .innerJoin(visitors, eq(visitors.id, sessions.visitorId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(visitors.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Writes are refused once data deletion has started, so nothing new is created mid-deletion. */
export function assertWritable(visitor: Visitor): void {
  if (visitor.deletionRequestedAt) {
    throw new AppError("DATA_DELETION_IN_PROGRESS", "正在删除这个访客的数据，暂时不能创建新记录");
  }
}

export async function revokeSession(token: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
