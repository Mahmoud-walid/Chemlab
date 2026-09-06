import { driverFor } from "@/db/driver";

/**
 * Configuration problems that are legal, parse cleanly, and still do not work.
 *
 * The schema in `lib/env.server.schema.ts` answers "is this a connection
 * string". These answer the questions that only matter once you know WHICH
 * database it points at — and every one of them has a failure mode that looks
 * like something else:
 *
 * - A Neon POOLED endpoint used for migrations fails with a lock error deep
 *   inside drizzle-kit, because PgBouncer in transaction mode cannot hold the
 *   session-level locks DDL needs.
 * - A Neon pooled endpoint used by the ANALYTICS client is worse, because it
 *   does not fail: that client sets `statement_timeout` on the connection
 *   (see `db/analytics-client.ts`), and a transaction pooler may hand the next
 *   statement to a different backend, where the setting is not in force. The
 *   bound silently stops applying.
 * - A Neon URL without `sslmode=require` is refused by Neon at connect time,
 *   with a message about SSL rather than about configuration.
 *
 * Kept pure and separate from `scripts/env-check.ts` so the rules can be
 * tested without an environment, and so the same rules could be reported
 * anywhere else that wants them.
 */

export type DiagnosticLevel = "error" | "warning";

export interface Diagnostic {
  level: DiagnosticLevel;
  /** One line naming what is wrong. */
  summary: string;
  /** What to do about it, in the reader's terms. */
  detail: string;
}

/** Neon's pooled endpoints carry `-pooler` in the host. */
export function isPooledHost(url: string): boolean {
  try {
    return new URL(url).hostname.includes("-pooler");
  } catch {
    return false;
  }
}

/** True for a host that terminates TLS and requires it. */
export function isNeon(url: string): boolean {
  return driverFor(url) === "neon";
}

function requiresSslParam(url: string): boolean {
  try {
    return new URL(url).searchParams.get("sslmode") !== "require";
  } catch {
    return false;
  }
}

export interface DatabaseUrls {
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
}

/**
 * Everything wrong with a pair of database URLs.
 *
 * All of them, not the first: somebody who fixes one and is then told about
 * the next has been made to discover the rules one deploy at a time.
 */
export function databaseDiagnostics(env: DatabaseUrls): Diagnostic[] {
  const found: Diagnostic[] = [];
  const app = env.DATABASE_URL;
  const direct = env.DATABASE_URL_UNPOOLED;

  if (!app) return found;

  if (isNeon(app) && requiresSslParam(app)) {
    found.push({
      level: "warning",
      summary: "DATABASE_URL has no ?sslmode=require",
      detail:
        "Neon refuses a connection without it, and reports an SSL error rather " +
        "than a configuration one. Append ?sslmode=require to the URL.",
    });
  }

  if (direct && isNeon(direct) && requiresSslParam(direct)) {
    found.push({
      level: "warning",
      summary: "DATABASE_URL_UNPOOLED has no ?sslmode=require",
      detail: "Same as above — Neon requires it on every endpoint.",
    });
  }

  // The one that costs the most to diagnose from the symptom.
  if (isPooledHost(app) && !direct) {
    found.push({
      level: "error",
      summary: "A pooled DATABASE_URL with no DATABASE_URL_UNPOOLED",
      detail:
        "Migrations, the seed and the admin analytics client all fall back to " +
        "DATABASE_URL when the direct endpoint is unset. Through a transaction " +
        "pooler, migrations fail on a session lock, and the analytics client's " +
        "statement_timeout silently stops applying because the next statement " +
        "may run on a different backend. Set DATABASE_URL_UNPOOLED to the same " +
        "Neon endpoint WITHOUT '-pooler' in the host.",
    });
  }

  if (direct && isPooledHost(direct)) {
    found.push({
      level: "error",
      summary: "DATABASE_URL_UNPOOLED points at a pooled endpoint",
      detail:
        "The '-pooler' host is the pooled one. This variable exists to name the " +
        "DIRECT endpoint — remove '-pooler' from its host.",
    });
  }

  // Deliberately NOT a diagnostic: the two being identical. That is the
  // correct local configuration — there is no pooler in front of a local
  // cluster — and it only looks like a copy-paste mistake.
  return found;
}

/** Which URL each client will actually use, for the report. */
export function resolvedEndpoints(env: DatabaseUrls): {
  app?: string;
  migrations?: string;
  analytics?: string;
} {
  return {
    app: env.DATABASE_URL,
    // Both prefer the direct endpoint and fall back to the app's — see
    // `db/seed/connect.ts` and `db/analytics-client.ts`.
    migrations: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
    analytics: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
  };
}
