import { UnrecoverableError, Worker, type Job } from "bullmq";
import { AiError } from "@tsq/core/ai/index";
import { capabilities } from "@tsq/core/config/env";
import { closeDb } from "@tsq/core/db/client";
import { AppError } from "@tsq/core/http/errors";
import { closeRedis, redis } from "@tsq/core/infra/redis";
import { publishOutboxBatch } from "@tsq/core/queue/outbox";
import { closeQueues, QUEUES, redisConnection } from "@tsq/core/queue/queues";
import { runHousekeeping } from "@tsq/core/services/maintenance";
import { resolveAi } from "@tsq/core/services/settings";
import { markStageFailed, processRate, processVerify, type Stage } from "@tsq/core/services/processing";
import { ensureBucket } from "@tsq/core/storage/s3";
import { posterProcessor } from "./posters";
import { maintenanceProcessor } from "./maintenance";

// Background worker: publishes the DB outbox into BullMQ and runs long jobs
// (AI calls, poster rendering, deletion) outside the request path (spec §7.1).

const HEARTBEAT_KEY = "tsq:worker:heartbeat";
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const faults = {
  failVerify: async () => (await redis().get("tsq:fake-ai:fail-verify")) === "1",
  failRating: async () => (await redis().get("tsq:fake-ai:fail-rating")) === "1",
};

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function errorCode(error: unknown): string {
  if (error instanceof AiError || error instanceof AppError) return error.code;
  return "INTERNAL_ERROR";
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AiError || error instanceof AppError) return error.retryable;
  return true; // unknown errors (e.g. DB hiccup) get the normal retry budget
}

async function attemptsProcessor(job: Job<{ id: string }>) {
  const stage = job.name as Stage;
  const attemptId = job.data.id;
  const queueWaitMs = job.processedOn && job.timestamp ? job.processedOn - job.timestamp : null;
  const started = Date.now();
  try {
    const result =
      stage === "verify"
        ? await processVerify(attemptId, { faults }, queueWaitMs)
        : await processRate(attemptId, { faults }, queueWaitMs);
    log("attempt stage done", { attempt_id: attemptId, stage, processing_ms: Date.now() - started, result });
    return result;
  } catch (error) {
    const code = errorCode(error);
    const final = !isRetryable(error) || isFinalAttempt(job);
    log("attempt stage error", {
      attempt_id: attemptId,
      stage,
      error_code: code,
      retry_count: job.attemptsMade,
      final,
      processing_ms: Date.now() - started,
    });
    if (final) {
      await markStageFailed(attemptId, stage, code);
      throw new UnrecoverableError(code);
    }
    throw error;
  }
}

async function main() {
  const caps = capabilities();
  // AI settings can change at runtime (admin console); each job resolves them again.
  const ai = await resolveAi();
  log("worker starting", { ai: ai.configured ? `${ai.source}:${ai.provider}` : `missing:${ai.missing.join(",")}` });
  if (caps.storage.configured) await ensureBucket();

  const connection = redisConnection();
  const workers = [
    new Worker(QUEUES.attempts, attemptsProcessor, { connection, concurrency: 4 }),
    new Worker(QUEUES.posters, posterProcessor, { connection, concurrency: 2 }),
    new Worker(QUEUES.maintenance, maintenanceProcessor, { connection, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on("error", (err) => log("worker error", { queue: w.name, error: err.message }));
  }

  let stopping = false;
  const publishLoop = async () => {
    while (!stopping) {
      try {
        let failed = 0;
        const n = await publishOutboxBatch(50, (f) => {
          failed += 1;
          log("outbox publish failed", { outbox_id: f.id, type: f.type, error: f.error });
        });
        // Back off while some rows keep failing, so a refused row is not retried in a hot loop.
        if (failed > 0) await new Promise((r) => setTimeout(r, 5000));
        else if (n === 0) await new Promise((r) => setTimeout(r, 500));
      } catch (error) {
        log("outbox publish failed", { error: error instanceof Error ? error.message : String(error) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  const publishing = publishLoop();

  const heartbeat = setInterval(() => {
    redis().set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 30).catch(() => undefined);
  }, 10_000);
  await redis().set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 30);

  const housekeeping = setInterval(() => {
    runHousekeeping()
      .then((r) => log("housekeeping", r))
      .catch((e) => log("housekeeping failed", { error: e instanceof Error ? e.message : String(e) }));
  }, 10 * 60_000);
  void runHousekeeping().catch(() => undefined);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("worker stopping", { signal });
    clearInterval(heartbeat);
    clearInterval(housekeeping);
    await publishing;
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  log("worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
