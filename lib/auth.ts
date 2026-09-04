import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/db/client";
import { buildAuthOptions } from "@/lib/auth-options";
import { getServerEnv, googleConfigured } from "@/lib/env.server";

/**
 * The server-side auth instance.
 *
 * Built lazily and memoised: `pnpm build` runs with no database and no secret,
 * and constructing this at module scope would fail the build for merely
 * importing the file. Every caller goes through `getAuth()`, which throws a
 * message naming what is missing rather than a library-internal error.
 *
 * The configuration itself lives in `lib/auth-options.ts`, so the integration
 * suite can run the real options against a disposable database.
 */

let cached: ReturnType<typeof create> | undefined;

function create() {
  const env = getServerEnv();

  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error(
      [
        "Auth is not configured.",
        "",
        "Set BETTER_AUTH_SECRET (openssl rand -base64 32) and BETTER_AUTH_URL",
        "in .env.local. Both are server-only — never give either a",
        "NEXT_PUBLIC_ prefix.",
      ].join("\n"),
    );
  }

  return betterAuth({
    ...buildAuthOptions({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      google: googleConfigured(env)
        ? {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          }
        : undefined,
      // The `__Secure-` prefix is a browser-enforced promise that the cookie
      // was set over HTTPS, so it can only be used where there is HTTPS.
      secureCookies: process.env.NODE_ENV === "production",
    }),

    // Must be last, and only here: it lets server actions set cookies, which
    // Next.js otherwise forbids from a plain response. Nothing outside the
    // Next runtime needs it.
    plugins: [nextCookies()],
  });
}

export function getAuth() {
  cached ??= create();
  return cached;
}

export { COOKIE_CACHE_SECONDS } from "@/lib/auth-options";
