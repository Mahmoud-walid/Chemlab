import "server-only";
import { parseServerEnv, type ServerEnv } from "./env.server.schema";

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

/** Memoised so repeated calls in one request do not re-validate. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  });
  return cached;
}

/** Test seam: forget the memoised value. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
