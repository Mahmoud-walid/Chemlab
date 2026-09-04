/**
 * Applies committed migrations.
 *
 *   pnpm db:migrate
 *
 * Runs against the DIRECT (unpooled) endpoint where one is configured: a
 * transaction pooler cannot hold the session-level locks DDL needs. Never run
 * automatically at app startup or during `next build` — a deploy applies
 * migrations as its own deliberate step.
 */
import "@/lib/load-env";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { driverFor } from "@/db/driver";

const MIGRATIONS = "./db/migrations";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before migrating.",
    );
    process.exit(1);
  }

  try {
    if (driverFor(url) === "neon") {
      if (!process.env.DATABASE_URL_UNPOOLED) {
        console.warn(
          "DATABASE_URL_UNPOOLED is not set; using DATABASE_URL.\n" +
            "If that is a pooled Neon endpoint, DDL may fail — use the direct one.",
        );
      }
      await migrateNeon(drizzleNeon(neon(url)), {
        migrationsFolder: MIGRATIONS,
      });
    } else {
      const pool = new Pool({ connectionString: url });
      try {
        await migrateNode(drizzleNode(pool), { migrationsFolder: MIGRATIONS });
      } finally {
        await pool.end();
      }
    }
    console.log("migrations applied");
  } catch (error) {
    // Never echo the URL: it carries the password inline.
    console.error("Migration failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
