import "server-only";
import { z } from "zod";

/**
 * Server-only configuration.
 *
 * Deliberately separate from `lib/env.ts`, which holds `NEXT_PUBLIC_*` values
 * that Next.js inlines into the JavaScript every visitor downloads. A Neon URL
 * carries its password inline, so putting one behind that prefix would publish
 * the credential.
 *
 * The `server-only` import above turns an accidental import from a client
 * component into a BUILD-time error rather than a runtime leak.
 *
 * Values are validated on first use, not at import. `pnpm build` runs with no
 * database configured, and validating at module scope would fail the build for
 * merely importing the file.
 */

const postgresUrl = z
  .string()
  .min(1, { message: "must not be empty" })
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

export const serverEnvSchema = z.object({
  /** Neon POOLED endpoint (the `-pooler` host). Used by the running app. */
  DATABASE_URL: postgresUrl,
  /**
   * Neon DIRECT endpoint. Used only by drizzle-kit and seed scripts: PgBouncer
   * in transaction mode cannot hold the session-level locks DDL needs.
   */
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Raw values as they arrive from the environment. */
export type ServerEnvInput = Partial<
  Record<keyof ServerEnv, string | undefined>
>;

/**
 * Validates raw server config. Empty strings count as unset, so a blank line in
 * `.env` produces the same clear error as a missing one.
 */
export function parseServerEnv(input: ServerEnvInput): ServerEnv {
  const cleaned = Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );

  const result = serverEnvSchema.safeParse(cleaned);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment configuration:\n${details}\n\n` +
        "These are server-only secrets. Set them in Vercel's environment " +
        "variables or a local .env.local — never with a NEXT_PUBLIC_ prefix.",
    );
  }

  return result.data;
}

let cached: ServerEnv | undefined;

/** Memoised so repeated calls in one request do not re-validate. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  });
  return cached;
}

/** Test seam: forget the memoised value. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
