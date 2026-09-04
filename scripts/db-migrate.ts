/**
 * Applies committed migrations.
 *
 *   pnpm db:migrate
 *
 * Runs against the DIRECT (unpooled) endpoint, because PgBouncer in
 * transaction mode cannot hold the session-level locks DDL needs. Never run
 * automatically at app startup or during `next build` — a deploy applies
 * migrations as its own deliberate step.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before migrating.",
    );
    process.exit(1);
  }

  if (process.env.DATABASE_URL_UNPOOLED === undefined) {
    console.warn(
      "DATABASE_URL_UNPOOLED is not set; falling back to DATABASE_URL.\n" +
        "If that is a pooled Neon endpoint, DDL may fail — use the direct one.",
    );
  }

  try {
    await migrate(drizzle(neon(url)), { migrationsFolder: "./db/migrations" });
    console.log("migrations applied");
  } catch (error) {
    console.error("Migration failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
