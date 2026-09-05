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

/**
 * Signing key for session cookies and tokens. 32 bytes of entropy is the floor
 * — a short secret makes every cookie forgeable, and rotating it invalidates
 * every session, so it is worth generating once with
 * `openssl rand -base64 32` and keeping.
 */
const authSecret = z.string().min(32, {
  message: "must be at least 32 characters (openssl rand -base64 32)",
});

const absoluteUrl = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an absolute http(s) URL, with no trailing path" },
);

export const serverEnvSchema = z.object({
  /**
   * Pooled endpoint. Used by the running app.
   *
   * Optional, because the app genuinely runs without a database — `pnpm build`,
   * the test suite and every public page do. Marking it required here would
   * make merely READING configuration throw on a deployment that has none.
   * `getDb()` raises the loud, specific error at the point where a database is
   * actually needed; when it IS set, it is still validated as a connection
   * string rather than accepted blindly.
   */
  DATABASE_URL: postgresUrl.optional(),
  /**
   * Direct endpoint. Used only by drizzle-kit and seed scripts: a transaction
   * pooler cannot hold the session-level locks DDL needs. Locally, where there
   * is no pooler, this is the same URL.
   */
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),

  /**
   * Auth configuration. Optional as a group: the app builds, runs and serves
   * every public page without accounts, exactly as it does without a database.
   * `authConfigured()` below says whether sign-in is available, so a missing
   * secret disables auth loudly at one point rather than throwing from a route
   * handler at request time.
   */
  BETTER_AUTH_SECRET: authSecret.optional(),
  /**
   * The canonical origin auth runs on. It must match the origin registered in
   * the Google redirect URI exactly, or the callback fails with a mismatch
   * that reads like a configuration error and is one.
   */
  BETTER_AUTH_URL: absoluteUrl.optional(),

  /**
   * Google OAuth. Optional on their own: with them the Google button appears,
   * without them the app is credential-only rather than broken.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * The email of the account `pnpm db:bootstrap-admin` grants the Super Admin
   * role to.
   *
   * Nobody can grant the first Super Admin through the app, because granting
   * requires being one. This names the owner instead. It is only ever READ —
   * the script looks up an existing user and refuses to create one, so no
   * password ever exists outside Better Auth's own hashing.
   */
  SUPER_ADMIN_EMAIL: z.string().email().optional(),

  /**
   * Web Push. The PRIVATE half of the VAPID pair, and the only one that must
   * never carry a `NEXT_PUBLIC_` prefix: it signs every push we send, and a
   * copy of it lets anyone send notifications that appear to come from us.
   * `scripts/bundle-check.ts` asserts it never reaches the client bundle.
   *
   * Optional as a group, like auth and the database: the app serves every page
   * without push, and `pushConfigured()` says whether it is available rather
   * than a route throwing at request time.
   */
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /**
   * Who the push service should contact about our traffic — a `mailto:` or an
   * `https:` URL. Required by the VAPID spec, and the address a push provider
   * uses when our sending looks abusive to them.
   */
  VAPID_SUBJECT: z
    .string()
    .refine(
      (value) => value.startsWith("mailto:") || value.startsWith("https://"),
      { message: "must be a mailto: address or an https: URL" },
    )
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** True when the app has a database to talk to. */
export function databaseConfigured(env: Partial<ServerEnv>): boolean {
  return Boolean(env.DATABASE_URL);
}

/** True when email/password sign-in can work: a secret and a URL are set. */
export function authConfigured(env: Partial<ServerEnv>): boolean {
  return Boolean(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL);
}

/**
 * True when the Google button should be shown. Both halves of the credential
 * are required — one without the other is a misconfiguration that would fail
 * at the callback, so it is treated as "not configured" instead.
 */
export function googleConfigured(env: Partial<ServerEnv>): boolean {
  return Boolean(
    authConfigured(env) && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
  );
}

/**
 * True when a push can actually be sent.
 *
 * Both VAPID halves and the subject are required together: a private key with
 * no public counterpart signs nothing a browser will accept, and the push
 * service rejects a request with no subject. Half a configuration is not
 * "partly working", it is a 400 at send time, so it counts as unconfigured.
 */
export function pushConfigured(
  env: Partial<ServerEnv>,
  publicKey: string | undefined,
): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && publicKey);
}

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
