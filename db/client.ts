import "server-only";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";
import { driverFor } from "./driver";
import { getServerEnv } from "@/lib/env.server";

/**
 * The database client, constructed on first use.
 *
 * Lazy on purpose: `pnpm build` runs with no database reachable, and a client
 * built at module scope would validate `DATABASE_URL` — and fail — simply
 * because a file imported this one.
 *
 * The driver is chosen from the URL; see `db/driver.ts`.
 */
type NeonDb = ReturnType<typeof drizzleNeon<typeof schema>>;
type NodeDb = ReturnType<typeof drizzleNode<typeof schema>>;

let cached: NeonDb | NodeDb | undefined;

export function getDb(): NeonDb | NodeDb {
  if (cached) return cached;

  const url = getServerEnv().DATABASE_URL;
  if (!url) {
    // The single loud, specific error. DATABASE_URL is optional in the schema
    // because the app runs without one; it stops being optional here, where
    // something actually wants to query.
    throw new Error(
      [
        "DATABASE_URL is not set, so there is no database to query.",
        "",
        "Start the local cluster and point .env.local at it:",
        "  pnpm db:local:start",
        "  cp .env.example .env.local",
        "  pnpm env:check",
        "",
        "It is a server-only secret — never give it a NEXT_PUBLIC_ prefix.",
      ].join("\n"),
    );
  }

  cached =
    driverFor(url) === "neon"
      ? drizzleNeon(neon(url), { schema, casing: "snake_case" })
      : drizzleNode(new Pool({ connectionString: url }), {
          schema,
          casing: "snake_case",
        });

  return cached;
}

export type Database = ReturnType<typeof getDb>;
