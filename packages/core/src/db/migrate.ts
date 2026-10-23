import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./client";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

await migrate(db(), { migrationsFolder });
console.log("数据库迁移完成");
await closeDb();
