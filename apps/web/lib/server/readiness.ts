import "server-only";
import { sql } from "drizzle-orm";
import { capabilities } from "@tsq/core/config/env";
import { db } from "@tsq/core/db/client";
import { redis } from "@tsq/core/infra/redis";
import { resolveAi, resolveMap } from "@tsq/core/services/settings";
import { putObject, getObject } from "@tsq/core/storage/s3";

// Readiness and capability check (spec §16.3). Reports each dependency
// separately; never claims "all good" when something is missing.

async function check(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 120) : "failed" };
  }
}

export async function readiness() {
  const caps = capabilities();
  const [aiConfig, mapConfig] = await Promise.all([resolveAi(), resolveMap()]);
  const database = await check(async () => {
    const r = await db().execute(sql`select count(*) from __drizzle_migrations`).catch(async () =>
      db().execute(sql`select count(*) from drizzle.__drizzle_migrations`),
    );
    if (!r.rows.length) throw new Error("migrations table empty");
  });
  const queue = await check(() => redis().ping());
  const worker = await check(async () => {
    const beat = await redis().get("tsq:worker:heartbeat");
    if (!beat) throw new Error("no worker heartbeat in the last 30s");
  });
  const storage = caps.storage.configured
    ? await check(async () => {
        await putObject("health/probe.txt", Buffer.from("ok"), "text/plain");
        await getObject("health/probe.txt");
      })
    : { ok: false, error: "not configured" };
  const ai = aiConfig.configured ? { ok: true } : { ok: false, error: "not configured" };
  const map = mapConfig.configured ? { ok: true } : { ok: false, error: "not configured (list view still works)" };
  const core = database.ok && queue.ok && worker.ok && storage.ok;
  return {
    ready: core,
    checks: { database, queue, worker, storage, ai, map },
    degraded: [!ai.ok && "照片核验不可用", !map.ok && "地图不可用，仅列表"].filter(Boolean),
  };
}
