import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { tsqPool?: pg.Pool; tsqDb?: Db };

export function pool(): pg.Pool {
  if (!globalForDb.tsqPool) {
    globalForDb.tsqPool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 10 });
  }
  return globalForDb.tsqPool;
}

export function db(): Db {
  if (!globalForDb.tsqDb) {
    globalForDb.tsqDb = drizzle(pool(), { schema });
  }
  return globalForDb.tsqDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.tsqPool?.end();
  globalForDb.tsqPool = undefined;
  globalForDb.tsqDb = undefined;
}
