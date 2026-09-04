import { z } from "zod";

/**
 * The server config schema and its parser, deliberately free of the
 * `server-only` guard.
 *
 * `server-only` throws outside a React Server Component — which is the point,
 * and which also makes the module unimportable from Node scripts and tests.
 * The guard lives in `lib/env.server.ts`, which application code imports; this
 * module holds the logic so `pnpm env:check` and the unit tests can reach it.
 */

const postgresUrl = z
  .string()
  .min(1, { message: "must not be empty" })
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

export const serverEnvSchema = z.object({
  /** Pooled endpoint. Used by the running app. */
  DATABASE_URL: postgresUrl,
  /**
   * Direct endpoint. Used only by drizzle-kit and seed scripts: a transaction
   * pooler cannot hold the session-level locks DDL needs. Locally, where there
   * is no pooler, this is the same URL.
   */
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type ServerEnvInput = Partial<
  Record<keyof ServerEnv, string | undefined>
>;

/**
 * Validates raw server config. Empty strings count as unset, so a blank line
 * in `.env` produces the same clear error as a missing one.
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
        "These are server-only secrets. Set them in .env.local or the " +
        "deployment's environment variables — never with a NEXT_PUBLIC_ " +
        "prefix, which publishes them to every visitor.",
    );
  }

  return result.data;
}
