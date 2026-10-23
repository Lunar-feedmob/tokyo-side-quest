import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { idempotencyKeys } from "../db/schema";
import { AppError } from "../http/errors";
import { sha256Hex } from "../security/tokens";

// Idempotency-Key handling (spec §8.3). Long-term dedupe of rewards and quest
// progress still relies on database unique constraints, not on this table.

export interface StoredResponse {
  status: number;
  body: unknown;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

export async function withIdempotency(
  opts: { visitorId: string; route: string; key: string | null; body: unknown },
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!opts.key) return run();
  if (!KEY_PATTERN.test(opts.key)) {
    throw new AppError("VALIDATION_ERROR", "Idempotency-Key 格式无效");
  }
  const requestHash = sha256Hex(JSON.stringify(opts.body ?? null));

  const inserted = await db()
    .insert(idempotencyKeys)
    .values({ visitorId: opts.visitorId, route: opts.route, key: opts.key, requestHash })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });

  if (inserted.length === 0) {
    const [existing] = await db()
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.visitorId, opts.visitorId),
          eq(idempotencyKeys.route, opts.route),
          eq(idempotencyKeys.key, opts.key),
        ),
      );
    if (!existing) return run();
    if (existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "同一个 Idempotency-Key 被用于不同的请求内容");
    }
    if (existing.statusCode !== null) {
      return { status: existing.statusCode, body: existing.response };
    }
    throw new AppError("IDEMPOTENCY_CONFLICT", "相同请求正在处理中，请稍后查看结果");
  }

  const id = inserted[0]!.id;
  try {
    const result = await run();
    await db()
      .update(idempotencyKeys)
      .set({ statusCode: result.status, response: result.body as object })
      .where(eq(idempotencyKeys.id, id));
    return result;
  } catch (error) {
    if (error instanceof AppError && error.status < 500 && error.code !== "RATE_LIMITED") {
      // Deterministic client errors are replayed for the same key.
      const body = { error: { code: error.code, message: error.message, retryable: error.retryable, details: error.details } };
      await db().update(idempotencyKeys).set({ statusCode: error.status, response: body }).where(eq(idempotencyKeys.id, id));
    } else {
      // Transient failure: release the key so the client can retry.
      await db().delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
    }
    throw error;
  }
}

export async function purgeExpiredIdempotencyKeys(hours = 24): Promise<number> {
  const res = await db()
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, sql`now() - make_interval(hours => ${hours})`))
    .returning({ id: idempotencyKeys.id });
  return res.length;
}
