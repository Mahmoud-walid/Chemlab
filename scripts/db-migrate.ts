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
import { describeError } from "@/lib/describe-error";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import ws from "ws";
import { driverFor } from "@/db/driver";

/**
 * Neon over WebSocket here too, and for a sharper reason than the app's.
 *
 * Drizzle's Postgres migrator wraps the whole run in ONE transaction and writes
 * each migration's `__drizzle_migrations` row inside it — so a failure rolls the
 * schema back and the bookkeeping with it. Every driver gets that from the
 * shared `pg-core` dialect except `neon-http`, which cannot hold a transaction
 * and therefore ships its own hand-rolled loop: every statement on its own, and
 * **all** of the bookkeeping rows deferred to after the last one.
 *
 * The failure that made this worth changing: three pending migrations, the third
 * fails halfway. One and two are fully applied to the schema, and
 * `__drizzle_migrations` records neither — so the next `pnpm db:migrate` replays
 * them against a schema that already has them, every `CREATE TABLE` fails, and
 * the only way forward is editing the bookkeeping table by hand. Atomicity is
 * what stops that, and only this driver has it.
 *
 * Invisible everywhere it could have been caught: CI and the container resolve
 * to `node-postgres`, which has been running all 27 migrations transactionally
 * and green the whole time. Neon was the one place without it.
 *
 * WebSocket is also the right transport for DDL specifically — it is a real
 * session, so it can hold the session-level locks the direct endpoint exists to
 * provide.
 *
 * `ws` rather than the global `WebSocket`: `package.json` allows Node 20, which
 * has none, and the failure without it is a connect-time error that names
 * neither Node nor this line.
 */
neonConfig.webSocketConstructor = ws;

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
      const pool = new NeonPool({ connectionString: url });
      try {
        await migrateNeon(drizzleNeon(pool), {
          migrationsFolder: MIGRATIONS,
        });
      } finally {
        // Without this the script holds the socket open and never exits, which
        // in a deploy step reads as a migration that hung rather than one that
        // finished.
        await pool.end();
      }
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
    console.error(describeError(error));
    process.exit(1);
  }
}

void main();
