/**
 * The auth OPTIONS, separated from the instance that uses them.
 *
 * The integration suite builds its own instance against a disposable database,
 * and if it built its own options too, it would be testing a configuration
 * nobody ships: the first version of these tests quietly omitted the profile
 * hook and the CSRF origin list, and passed. Everything security-relevant —
 * session strategy, cookie flags, rate limiting, linking rules — lives here so
 * production and the tests cannot drift.
 *
 * `lib/auth.ts` adds only what needs the Next.js runtime.
 */
import { APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, gte, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import * as schema from "@/db/schema";
import { DEFAULT_ROLE_KEY } from "@/db/schema/rbac";
import { decide, hashIdentifier, WINDOW_MS } from "@/lib/auth-rate-limit";

/** How long a signed session snapshot is trusted without touching the database. */
export const COOKIE_CACHE_SECONDS = 5 * 60;

export interface AuthOptionsInput {
  /** Any Drizzle database bound to our schema. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  secret: string;
  baseURL: string;
  google?: { clientId: string; clientSecret: string };
  secureCookies?: boolean;
}

export function buildAuthOptions({
  db,
  secret,
  baseURL,
  google,
  secureCookies = false,
}: AuthOptionsInput) {
  const origin = new URL(baseURL).origin;

  return {
    // The Drizzle adapter writes into OUR schema, so the auth tables are
    // migrated by drizzle-kit like every other table. The library never owns
    // migrations here.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    secret,
    baseURL,

    // Exact origins, never a wildcard: this list is what stops a hostile page
    // from driving state-changing auth requests with the visitor's cookies.
    trustedOrigins: [origin],

    advanced: {
      /**
       * Explicit, because Better Auth turns the origin check OFF by default
       * when NODE_ENV is "test" — which would mean the integration suite
       * proved a CSRF defence that production has and the test run does not.
       * A security control should not depend on an environment variable.
       */
      disableOriginCheck: false,
      // Time-ordered ids on the library's tables too, so they sort by creation
      // and index writes stay at the right-hand edge of the B-tree.
      database: { generateId: () => uuidv7() },
      // Applied on top of Better Auth's own defaults (httpOnly, sameSite=lax,
      // path=/). The __Secure- prefix is a browser-enforced promise that the
      // cookie was set over HTTPS.
      useSecureCookies: secureCookies,
    },

    emailAndPassword: {
      enabled: true,
      // Sign-in is allowed before verification; only account LINKING is gated
      // on it (see account linking below). Requiring it first would need an
      // email provider, which this issue does not choose.
      requireEmailVerification: false,
      // Length beats composition rules. 12 characters of anything outscores
      // eight characters of symbol theatre.
      minPasswordLength: 12,
      maxPasswordLength: 512,
    },

    socialProviders: google ? { google } : {},

    account: {
      accountLinking: {
        enabled: true,
        // Google only, and only because Google asserts email_verified in the
        // ID token. Blanket trust here is account takeover by signup: anyone
        // who can get a provider to assert an email they do not own inherits
        // the matching account.
        trustedProviders: google ? ["google"] : [],
      },
    },

    session: {
      // Database sessions, not stateless JWTs: deleting the row must be able
      // to kill a session immediately, which a JWT cannot offer until expiry.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // The common path skips the session query for this long, so a
        // revocation can linger up to COOKIE_CACHE_SECONDS. Documented in
        // docs/AUTH.md; the RBAC issue may want it shorter.
        enabled: true,
        maxAge: COOKIE_CACHE_SECONDS,
      },
    },

    user: {
      // Changing an email is out of scope for this issue; leaving the flow
      // enabled without an email provider would let an address be claimed
      // without ever proving ownership of it.
      changeEmail: { enabled: false },
    },

    databaseHooks: {
      user: {
        create: {
          /**
           * Every user gets a profile row, created in the same flow that
           * created them. Doing it lazily on first read would mean every
           * caller has to handle "user exists but profile does not", and one
           * that forgets renders a signed-in visitor as anonymous.
           *
           * Google fills the display name and avatar; the avatar URL is
           * recorded with its source so a later Cloudinary upload knows it is
           * replacing a cached remote value rather than a user-chosen one.
           */
          after: async (user: {
            id: string;
            name?: string | null;
            email: string;
            image?: string | null;
          }) => {
            await db
              .insert(schema.profiles)
              .values({
                userId: user.id,
                displayName: user.name?.trim() || user.email.split("@")[0]!,
                avatarUrl: user.image ?? null,
                avatarSource: user.image ? "google" : "initials",
              })
              .onConflictDoNothing({ target: schema.profiles.userId });

            // Every signup holds the default role, so "authenticated but
            // unprivileged" is a real, inspectable state rather than an absence
            // of rows — which is indistinguishable from a failed assignment.
            const [defaultRole] = await db
              .select({ id: schema.roles.id })
              .from(schema.roles)
              .where(eq(schema.roles.key, DEFAULT_ROLE_KEY))
              .limit(1);

            if (defaultRole) {
              await db
                .insert(schema.userRoles)
                .values({ userId: user.id, roleId: defaultRole.id })
                .onConflictDoNothing();
            }
          },
        },
      },
    },

    hooks: {
      /**
       * Rate limiting for credential sign-in, per email AND per IP.
       *
       * Per email alone lets a botnet spray one password across many accounts;
       * per IP alone lets one host with many addresses grind a single account.
       * Both identifiers are hashed before they are stored.
       *
       * The response is deliberately generic and identical to a wrong
       * password, so the limiter is not itself an oracle for which addresses
       * exist.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;

        const email = (ctx.body as { email?: string } | undefined)?.email;
        const ip = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0];
        const keys = [email && `email:${email}`, ip && `ip:${ip}`]
          .filter((value): value is string => Boolean(value))
          .map(hashIdentifier);
        if (keys.length === 0) return;

        const since = new Date(Date.now() - WINDOW_MS);

        for (const key of keys) {
          const [row] = await db
            .select({ failures: sql<number>`count(*)::int` })
            .from(schema.authAttempts)
            .where(
              and(
                eq(schema.authAttempts.key, key),
                eq(schema.authAttempts.kind, "sign_in"),
                eq(schema.authAttempts.succeeded, false),
                gte(schema.authAttempts.attemptedAt, since),
              ),
            );

          const verdict = decide(Number(row?.failures ?? 0));
          if (!verdict.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many attempts. Try again later.",
            });
          }
        }
      }),

      /**
       * Records the outcome. A 200 from `/sign-in/email` is a success; anything
       * else is a failure and counts toward the lockout above.
       */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;

        const email = (ctx.body as { email?: string } | undefined)?.email;
        const ip = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0];
        const succeeded = Boolean(ctx.context.newSession);
        const rows = [email && `email:${email}`, ip && `ip:${ip}`]
          .filter((value): value is string => Boolean(value))
          .map((value) => ({
            key: hashIdentifier(value),
            kind: "sign_in",
            succeeded,
          }));

        if (rows.length > 0) {
          await db.insert(schema.authAttempts).values(rows);
        }
      }),
    },
  };
}
