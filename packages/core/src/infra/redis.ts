import { Redis } from "ioredis";
import { env } from "../config/env";

const globalForRedis = globalThis as unknown as { tsqRedis?: Redis };

export function redis(): Redis {
  if (!globalForRedis.tsqRedis) {
    globalForRedis.tsqRedis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return globalForRedis.tsqRedis;
}

export async function closeRedis(): Promise<void> {
  await globalForRedis.tsqRedis?.quit().catch(() => undefined);
  globalForRedis.tsqRedis = undefined;
}
