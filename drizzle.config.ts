import "./lib/load-env";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit talks to the DIRECT (unpooled) endpoint: PgBouncer in
 * transaction mode cannot hold the session-level locks DDL needs.
 *
 * No validation here — `drizzle-kit generate` reads the schema and needs no
 * database at all, so requiring a URL would break generating migrations
 * offline. Commands that do connect fail with drizzle-kit's own error.
 */
export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgres://unset",
  },
  strict: true,
  verbose: true,
});
