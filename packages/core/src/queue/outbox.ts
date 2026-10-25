import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { db } from "../db/client";
import { outboxEvents } from "../db/schema";
import { EVENT_ROUTES, queue, type OutboxEventType } from "./queues";

/**
 * Record a job in the same transaction as the business write (spec §9.3 item 1).
 * The worker's publisher moves it into BullMQ; a queue outage only delays it.
 */
export async function enqueueInTx(
  tx: DbOrTx,
  type: OutboxEventType,
  aggregateId: string,
  jobId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(outboxEvents).values({ type, aggregateId, jobId, payload: { ...payload, id: aggregateId } });
}

/** Publish pending outbox rows. Safe to run concurrently: rows are claimed with SKIP LOCKED. */
export async function publishOutboxBatch(limit = 50): Promise<number> {
  return db().transaction(async (tx) => {
    const rows = await tx.execute<{ id: number; type: string; aggregate_id: string; job_id: string; payload: Record<string, unknown> }>(sql`
      select id, type, aggregate_id, job_id, payload from outbox_events
      where published_at is null
      order by id
      limit ${limit}
      for update skip locked
    `);
    let published = 0;
    for (const row of rows.rows) {
      const route = EVENT_ROUTES[row.type as OutboxEventType];
      if (!route) {
        await tx.execute(sql`update outbox_events set last_error = 'unknown event type', publish_attempts = publish_attempts + 1 where id = ${row.id}`);
        continue;
      }
      try {
        // Stable jobId: re-publishing after a crash cannot create a second job.
        await queue(route.queue).add(route.job, row.payload, { jobId: row.job_id });
        await tx.execute(sql`update outbox_events set published_at = now(), publish_attempts = publish_attempts + 1 where id = ${row.id}`);
        published += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "publish failed";
        await tx.execute(sql`update outbox_events set last_error = ${message}, publish_attempts = publish_attempts + 1 where id = ${row.id}`);
        break; // Queue is likely unavailable; retry the batch later.
      }
    }
    return published;
  });
}
