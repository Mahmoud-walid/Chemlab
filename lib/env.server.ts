import "server-only";
import {
  parseServerEnv,
  serverEnvSchema,
  type ServerEnv,
} from "./env.server.schema";

/**
 * Server-only configuration, for application code.
 *
 * The `server-only` import turns an accidental import from a client component
 * into a BUILD-time error rather than a runtime leak — a database URL carries
 * its password inline, and anything reachable from the client bundle is
 * published.
 *
 * Values are validated on first use, not at import: `pnpm build` runs with no
 * database configured, and validating at module scope would fail the build for
 * merely importing this file.
 *
 * Scripts and tests import `./env.server.schema` instead, which holds the same
 * logic without the guard.
 */
export {
  authConfigured,
  databaseConfigured,
  googleConfigured,
  parseServerEnv,
  serverEnvSchema,
  type ServerEnv,
  type ServerEnvInput,
} from "./env.server.schema";

let cached: ServerEnv | undefined;

/**
 * Every key the schema declares, read from `process.env`.
 *
 * Derived from the schema rather than listed by hand, and that is not a
 * tidiness preference — the hand-written list silently went stale. The VAPID
 * variables were added to the schema and never added here, so
 * `getServerEnv().VAPID_PRIVATE_KEY` was `undefined` in a correctly configured
 * deployment, `pushConfigured()` answered false, and **no push would ever have
 * been sent**. Nothing failed: the sender simply declined, which is exactly
 * how the notification pipeline was proven working end to end while being
 * unable to send at all.
 *
 * A list you must remember to update is a list that will be forgotten. This
 * cannot be, and `tests/lib/env-server.test.ts` fails if the derivation is
 * replaced by another one.
 *
 * `process.env` is read by literal key rather than spread whole: Next inlines
 * `process.env.X` at build time only for literal accesses, and a bundler that
 * cannot see the key cannot keep it.
 */
function readEnv(): Record<string, string | undefined> {
  const keys = Object.keys(serverEnvSchema.shape) as (keyof ServerEnv)[];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

/** Memoised so repeated calls in one request do not re-validate. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(readEnv());
  return cached;
}

/** Test seam: forget the memoised value. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
