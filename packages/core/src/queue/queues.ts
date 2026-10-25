import { Queue, type JobsOptions } from "bullmq";
import { env } from "../config/env";

export const QUEUES = {
  attempts: "tsq-attempts",
  posters: "tsq-posters",
  maintenance: "tsq-maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Outbox event type → queue + job name. */
export const EVENT_ROUTES = {
  "attempt.verify": { queue: QUEUES.attempts, job: "verify" },
  "attempt.rate": { queue: QUEUES.attempts, job: "rate" },
  "poster.render": { queue: QUEUES.posters, job: "render" },
  "photo.delete": { queue: QUEUES.maintenance, job: "photo-delete" },
  "visitor.delete": { queue: QUEUES.maintenance, job: "visitor-delete" },
  "poster.delete": { queue: QUEUES.maintenance, job: "poster-delete" },
} as const;

export type OutboxEventType = keyof typeof EVENT_ROUTES;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // Up to 3 tries with exponential backoff for transient failures (spec §9.3 item 7).
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function redisConnection() {
  return { url: env().REDIS_URL, maxRetriesPerRequest: null };
}

const globalForQueues = globalThis as unknown as { tsqQueues?: Map<string, Queue> };

export function queue(name: QueueName): Queue {
  globalForQueues.tsqQueues ??= new Map();
  let q = globalForQueues.tsqQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    globalForQueues.tsqQueues.set(name, q);
  }
  return q;
}

export async function closeQueues(): Promise<void> {
  for (const q of globalForQueues.tsqQueues?.values() ?? []) await q.close();
  globalForQueues.tsqQueues?.clear();
}
