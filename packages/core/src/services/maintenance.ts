import { and, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { checkins, sessions } from "../db/schema";
import { purgeExpiredIdempotencyKeys } from "./idempotency";

/** Raw coordinates are kept only for the retention window (spec §8.2). */
export async function purgeRawLocations(): Promise<number> {
  const hours = env().LOCATION_RAW_RETENTION_HOURS;
  const res = await db()
    .update(checkins)
    .set({ rawLatitude: null, rawLongitude: null, rawPurgedAt: new Date() })
    .where(
      and(
        isNotNull(checkins.rawLatitude),
        isNull(checkins.rawPurgedAt),
        lt(checkins.acceptedAt, sql`now() - make_interval(hours => ${hours})`),
      ),
    )
    .returning({ id: checkins.id });
  return res.length;
}

export async function purgeExpiredSessions(): Promise<number> {
  const res = await db().delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return res.length;
}

export async function runHousekeeping() {
  const [rawLocations, idempotency, expiredSessions] = await Promise.all([
    purgeRawLocations(),
    purgeExpiredIdempotencyKeys(24),
    purgeExpiredSessions(),
  ]);
  return { rawLocations, idempotency, expiredSessions };
}
