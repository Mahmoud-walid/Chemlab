/**
 * Validates configuration and reports what is set, without printing secrets.
 *
 *   pnpm env:check
 *
 * Exits non-zero if anything required is missing or malformed, so it works as
 * a pre-deploy or pre-seed gate. Secret VALUES are never printed — only
 * whether each is present, and enough shape to debug a typo.
 */
import "../lib/load-env";
import { parseEnv } from "../lib/env";
import {
  authConfigured,
  googleConfigured,
  parseServerEnv,
} from "../lib/env.server.schema";
import { driverFor } from "../db/driver";

/** `postgresql://user:pw@host:5432/db` -> `postgresql://user:***@host:5432/db` */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable>";
  }
}

function heading(text: string) {
  console.log(`\n${text}`);
  console.log("─".repeat(text.length));
}

let failed = false;

heading("Public configuration");
try {
  const env = parseEnv({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
    NEXT_PUBLIC_TWITTER_HANDLE: process.env.NEXT_PUBLIC_TWITTER_HANDLE,
  });
  // These are public by definition — Next.js inlines them into the bundle —
  // so printing them leaks nothing.
  console.log(`  NEXT_PUBLIC_SITE_URL          ${env.NEXT_PUBLIC_SITE_URL}`);
  console.log(`  NEXT_PUBLIC_SITE_NAME         ${env.NEXT_PUBLIC_SITE_NAME}`);
  console.log(
    `  NEXT_PUBLIC_TWITTER_HANDLE    ${env.NEXT_PUBLIC_TWITTER_HANDLE ?? "(unset)"}`,
  );
  if (env.NEXT_PUBLIC_SITE_URL.includes("localhost")) {
    console.log(
      "\n  note: site URL is localhost — fine locally, but canonical URLs\n" +
        "        and social cards in production need the real domain.",
    );
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
}

heading("Server configuration");
if (!process.env.DATABASE_URL) {
  console.log("  DATABASE_URL                  (unset)");
  console.log(
    "\n  The app, the test suite and `pnpm build` all work without a\n" +
      "  database. Set it when you want migrations or real data:\n" +
      "    pnpm db:local:start   # start the container's Postgres\n" +
      "    cp .env.example .env.local",
  );
} else {
  try {
    const env = parseServerEnv({
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    });
    // Guarded above: this branch only runs when DATABASE_URL is set.
    const databaseUrl = env.DATABASE_URL!;
    console.log(`  DATABASE_URL                  ${redact(databaseUrl)}`);
    console.log(
      `  DATABASE_URL_UNPOOLED         ${
        env.DATABASE_URL_UNPOOLED
          ? redact(env.DATABASE_URL_UNPOOLED)
          : "(unset — migrations will use DATABASE_URL)"
      }`,
    );
    console.log(`  driver                        ${driverFor(databaseUrl)}`);
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

heading("Authentication");
try {
  const env = parseServerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  });

  // Presence, never the value: this secret signs every session cookie.
  console.log(
    `  BETTER_AUTH_SECRET            ${
      env.BETTER_AUTH_SECRET
        ? `set (${env.BETTER_AUTH_SECRET.length} chars)`
        : "(unset)"
    }`,
  );
  console.log(
    `  BETTER_AUTH_URL               ${env.BETTER_AUTH_URL ?? "(unset)"}`,
  );
  console.log(
    `  GOOGLE_CLIENT_ID              ${env.GOOGLE_CLIENT_ID ? "set" : "(unset)"}`,
  );
  console.log(
    `  GOOGLE_CLIENT_SECRET          ${env.GOOGLE_CLIENT_SECRET ? "set" : "(unset)"}`,
  );

  console.log(
    `\n  sign-in                       ${
      authConfigured(env)
        ? googleConfigured(env)
          ? "email/password and Google"
          : "email/password only (no Google credentials)"
        : "disabled (no BETTER_AUTH_SECRET / BETTER_AUTH_URL)"
    }`,
  );

  // The auth origin must match the origin registered in the Google redirect
  // URI. A mismatch surfaces as an opaque callback failure, so it is worth
  // catching here.
  if (env.BETTER_AUTH_URL) {
    const authOrigin = new URL(env.BETTER_AUTH_URL).origin;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (siteUrl && new URL(siteUrl).origin !== authOrigin) {
      console.log(
        `\n  note: BETTER_AUTH_URL (${authOrigin}) and NEXT_PUBLIC_SITE_URL\n` +
          `        (${new URL(siteUrl).origin}) disagree. The OAuth callback is\n` +
          "        registered against the auth origin, so a mismatch fails at\n" +
          "        the Google callback rather than here.",
      );
    }
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
}

heading("Leak check");
const leaked = Object.keys(process.env).filter(
  (key) =>
    key.startsWith("NEXT_PUBLIC_") &&
    /DATABASE|SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|CLIENT_ID/i.test(key),
);
if (leaked.length > 0) {
  failed = true;
  console.error(
    `  ${leaked.join(", ")}\n\n` +
      "  A NEXT_PUBLIC_ variable is inlined into the JavaScript every visitor\n" +
      "  downloads. Anything above is published, not configured.",
  );
} else {
  console.log("  no secrets behind a NEXT_PUBLIC_ prefix");
}

console.log(failed ? "\nenv:check failed\n" : "\nenv:check passed\n");
process.exit(failed ? 1 : 0);
