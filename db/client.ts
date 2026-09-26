import "server-only";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { Pool } from "pg";
import ws from "ws";
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

/**
 * Neon over its **WebSocket** driver, not its HTTP one.
 *
 * This is the whole reason the import above is `neon-serverless` rather than
 * the `neon-http` that reads faster. HTTP has no session, so it cannot hold an
 * interactive transaction, and drizzle's HTTP driver does not pretend
 * otherwise: `.transaction()` on it throws
 * `No transactions support in neon-http driver` — before it connects, on every
 * call, with nothing to configure.
 *
 * Thirty-four call sites need one. Publishing a lesson, saving a quiz,
 * assigning a role, erasing a row, updating a profile and **submitting an exam**
 * all wrap their writes in `getDb().transaction(...)` because a half-applied
 * write there is a corrupted lesson or a lost mark. With the HTTP driver every
 * one of those throws the moment `DATABASE_URL` names a `*.neon.tech` host —
 * which is production.
 *
 * Nothing catches that locally or in CI. `driverFor()` reads the hostname, a
 * container and CI both point at plain Postgres, and `node-postgres` holds
 * transactions perfectly well — so the suites exercise a driver production does
 * not use, pass, and prove nothing about the one it does. `db/seed/connect.ts`
 * reached the same conclusion for the seed and the integration tests and opened
 * the WebSocket pool; the app is the third caller that needs it, and the only
 * one where the failure reaches a reader.
 *
 * The cost accepted: a WebSocket handshake on a cold invocation, where HTTP
 * would have been one request. It is not the one-sided trade it sounds like —
 * HTTP pays a round trip *per statement*, so a page taking five reads pays five,
 * while the pool pays once and reuses the connection. The reason to choose this
 * side is correctness either way: a driver that cannot do what the call sites
 * need is not a faster option, it is a broken one.
 *
 * `ws` rather than the global `WebSocket`: `package.json` allows Node 20, which
 * has none, and the failure without it is a connect-time error that names
 * neither Node nor this line. It is a runtime dependency for that reason — a
 * `devDependencies` entry would build here and fail in production.
 */
neonConfig.webSocketConstructor = ws;

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
      ? drizzleNeon(new NeonPool({ connectionString: url }), {
          schema,
          casing: "snake_case",
        })
      : drizzleNode(new Pool({ connectionString: url }), {
          schema,
          casing: "snake_case",
        });

  return cached;
}

export type Database = ReturnType<typeof getDb>;
