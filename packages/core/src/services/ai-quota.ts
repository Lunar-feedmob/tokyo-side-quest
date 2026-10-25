import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { aiCalls, photoAttempts } from "../db/schema";
import { AppError } from "../http/errors";
import { resolveAiDailyLimit } from "./settings";

// Site-wide daily budget for model calls (decision D27). "Used" is the real
// calls recorded since Tokyo midnight plus what accepted live attempts still
// in the queue are expected to call, so a burst of submissions cannot run far
// past the limit. New work that would not fit is refused up front; work that
// was already accepted always finishes. Cached evaluations make no calls and
// are never refused. Admin "test connection" calls have their own hourly limit
// and are not counted here.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TOKYO_OFFSET_MS = 9 * HOUR_MS; // Japan has no daylight saving time

/** Start of the Tokyo calendar day containing `now`. */
export function tokyoDayStart(now: Date = new Date()): Date {
  return new Date(Math.floor((now.getTime() + TOKYO_OFFSET_MS) / DAY_MS) * DAY_MS - TOKYO_OFFSET_MS);
}

/** Calls a stage is expected to make: a verification is usually followed by a rating. */
export function expectedCalls(stage: "verify" | "rate"): number {
  return stage === "verify" ? 2 : 1;
}

export interface AiQuotaStatus {
  limit: number;
  source: "settings" | "env";
  /** Model calls since Tokyo midnight (verify + rate, failed calls included). */
  used: number;
  /** Calls that accepted live attempts are still expected to make. */
  pending: number;
  /** Estimated cost of today's calls; calls without an estimate are counted in unpricedCalls. */
  estimatedCostUsd: number;
  unpricedCalls: number;
  resetsAt: string;
  /** No room left for one more photo. */
  exhausted: boolean;
}

export async function aiQuotaStatus(now: Date = new Date()): Promise<AiQuotaStatus> {
  const start = tokyoDayStart(now);
  const { limit, source } = await resolveAiDailyLimit();
  const [calls] = await db()
    .select({
      used: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${aiCalls.estimatedCostUsd}), 0)::float8`,
      unpriced: sql<number>`(count(*) filter (where ${aiCalls.estimatedCostUsd} is null))::int`,
    })
    .from(aiCalls)
    .where(and(gte(aiCalls.createdAt, start), inArray(aiCalls.stage, ["verify", "rate"])));
  const [queued] = await db()
    .select({
      pending: sql<number>`coalesce(sum(case when ${photoAttempts.verificationStatus} = 'pending' then 2 else 1 end), 0)::int`,
    })
    .from(photoAttempts)
    .where(
      and(
        eq(photoAttempts.mode, "live"),
        isNull(photoAttempts.cancelledAt),
        inArray(photoAttempts.processingStatus, ["queued", "running"]),
        or(eq(photoAttempts.verificationStatus, "pending"), eq(photoAttempts.ratingStatus, "pending")),
        // An attempt stuck for a day should not hold today's budget forever.
        gte(photoAttempts.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  const used = calls?.used ?? 0;
  const pending = queued?.pending ?? 0;
  return {
    limit,
    source,
    used,
    pending,
    estimatedCostUsd: calls?.cost ?? 0,
    unpricedCalls: calls?.unpriced ?? 0,
    resetsAt: new Date(start.getTime() + DAY_MS).toISOString(),
    exhausted: used + pending + expectedCalls("verify") > limit,
  };
}

/** Refuses new live work for `stage` when it would not fit in today's budget. */
export async function enforceAiDailyLimit(stage: "verify" | "rate"): Promise<void> {
  const s = await aiQuotaStatus();
  if (s.used + s.pending + expectedCalls(stage) > s.limit) {
    throw new AppError(
      "AI_DAILY_LIMIT_REACHED",
      "今天的照片核验名额已经用完，东京时间明天 0 点恢复。你可以先使用定位打卡，或去在线试玩。",
      { resetsAt: s.resetsAt },
    );
  }
}
