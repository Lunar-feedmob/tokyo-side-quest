import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://tsq:tsq-local-password@127.0.0.1:5433/tsq" },
  extensionsFilters: ["postgis"],
});
