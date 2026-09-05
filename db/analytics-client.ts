import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import { getServerEnv } from "@/lib/env.server";

/**
 * A second database client, for admin analytics only.
 *
 * The public site and the admin dashboards want opposite things from a
 * connection. A lesson page wants a connection now, from a pool sized for
 * traffic. A dashboard runs aggregates whose cost grows with the product's
 * whole history, and the one thing it must never do is take the pool serving
 * `/lessons` with it when one of those aggregates goes wrong.
 *
 * So analytics gets its own client, and it is deliberately small and
 * deliberately impatient:
 *
 * - **`max: 2`.** Not a performance number — a blast radius. Whatever an
 *   analytics query does, it can occupy two connections and no more. The
 *   interactive pool is untouched because it is a different pool.
 * - **A session `statement_timeout`.** Carried in the connection's startup
 *   packet, not issued per query, so a query written next year that forgets
 *   about it is still covered. This is the structural half of the guarantee:
 *   the bound does not depend on anybody remembering.
 * - **`connectionTimeoutMillis`.** With two connections, a third caller
 *   waits. It should wait briefly and then fail, rather than holding a
 *   request open indefinitely for a dashboard. Contention inside analytics
 *   stays inside analytics.
 *
 * ## Why node-postgres, always
 *
 * `db/client.ts` picks its driver from the URL and uses Neon's HTTP driver
 * for Neon hosts. That driver cannot be used here: `statement_timeout` is a
 * SESSION setting, and the HTTP driver has no session to set it on — each
 * query is an independent request. A guarantee that has to be re-stated on
 * every query is the guarantee this issue exists to replace.
 *
 * `DATABASE_URL_UNPOOLED` is the direct endpoint on every provider that
 * distinguishes the two, and a direct endpoint speaks the ordinary wire
 * protocol, which is what `pg` needs. It is also the URL every batch script
 * in this repo already resolves first (`db/seed/connect.ts`).
 *
 * The cost, stated rather than discovered: this opens TCP connections, so a
 * deployment target with no outbound TCP would need the Neon WebSocket pool
 * here instead. The pool is bounded at two per instance precisely so that
 * cost stays small.
 */

/**
 * Five seconds. Long enough that no dashboard query written to read the
 * rollup tables will ever reach it, short enough that a reader waiting on a
 * broken one gets an error instead of a spinner.
 *
 * The exports share it, deliberately — see `docs/ACTIVITY.md`. A
 * `statement_timeout` bounds one STATEMENT, not one download, and every
 * export already reads in keyset batches. An export that trips this has lost
 * the batching that makes it safe, and that is worth being told about.
 */
export const ANALYTICS_STATEMENT_TIMEOUT_MS = 5_000;

/** Two connections is the blast radius, not a throughput target. */
export const ANALYTICS_POOL_MAX = 2;

type AnalyticsDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface AnalyticsClient {
  db: AnalyticsDatabase;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Builds one. Exported so tests can construct a client with a short timeout
 * instead of waiting five seconds to prove the timeout exists.
 */
export function createAnalyticsClient(
  url: string,
  {
    statementTimeoutMs = ANALYTICS_STATEMENT_TIMEOUT_MS,
    max = ANALYTICS_POOL_MAX,
  }: { statementTimeoutMs?: number; max?: number } = {},
): AnalyticsClient {
  const pool = new Pool({
    connectionString: url,
    max,
    /**
     * The timeout, in the connection's STARTUP packet.
     *
     * `-c name=value` is how a client asks Postgres to begin a session with a
     * setting already applied, so the very first statement on a fresh
     * connection is bounded — there is no window in which a connection has
     * been handed out but not yet configured.
     *
     * The obvious alternative, issuing `SET statement_timeout` from the
     * pool's `connect` event, relies on node-postgres queuing that query
     * ahead of the caller's on the same client. It works today and warns
     * that it will not: pg deprecates calling `query()` on a client that is
     * already executing one, and removes it in pg@9. A guarantee resting on
     * a deprecated ordering is a guarantee with an expiry date.
     *
     * The trade: a connection proxy that does not recognise the option
     * refuses the connection. That failure is loud, confined to the admin
     * dashboards, and preferable to the quiet alternative — an analytics
     * pool that believes it is bounded and is not.
     */
    options: `-c statement_timeout=${statementTimeoutMs}`,
    // A dashboard is opened in bursts and then not again for an hour. Holding
    // connections open between those bursts spends the direct endpoint's
    // budget on nothing.
    idleTimeoutMillis: 10_000,
    // Fail fast when both connections are busy. The alternative is a request
    // that hangs for as long as the slow query it is queued behind.
    connectionTimeoutMillis: 5_000,
    // So a script or a test process is not held open by an idle pool.
    allowExitOnIdle: true,
  });

  /**
   * A pool with no error listener crashes the process when Postgres closes an
   * idle connection — which it does routinely.
   */
  pool.on("error", () => {});

  return {
    db: drizzle(pool, { schema, casing: "snake_case" }),
    pool,
    close: () => pool.end(),
  };
}

let cached: AnalyticsClient | undefined;

/**
 * The app's analytics handle, constructed on first use.
 *
 * Lazy for the same reason `getDb()` is: `pnpm build` runs with no database
 * reachable, and a pool built at module scope would fail the build for the
 * sin of being imported.
 */
export function getAnalyticsDb(): AnalyticsDatabase {
  return (cached ??= createAnalyticsClient(analyticsUrl())).db;
}

/** Test seam: drop the pool so a suite does not leave connections open. */
export async function closeAnalyticsDb(): Promise<void> {
  const client = cached;
  cached = undefined;
  await client?.close();
}

/**
 * The direct endpoint when there is one, otherwise whatever the app uses.
 *
 * Unpooled first because that is where a session setting survives: a
 * transaction-mode pooler may hand the next statement a different backend,
 * and `statement_timeout` set on connect would then apply to somebody else's
 * work rather than to this query.
 */
function analyticsUrl(): string {
  const env = getServerEnv();
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      [
        "No database URL, so the admin dashboards have nothing to read.",
        "",
        "Set DATABASE_URL_UNPOOLED (preferred — analytics wants the direct",
        "endpoint) or DATABASE_URL:",
        "  pnpm db:local:start",
        "  cp .env.example .env.local",
        "  pnpm env:check",
        "",
        "Both are server-only secrets — never give either a NEXT_PUBLIC_ prefix.",
      ].join("\n"),
    );
  }
  return url;
}
