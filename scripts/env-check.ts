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
  ciNotifyConfigured,
  googleConfigured,
  parseServerEnv,
  pushConfigured,
  slackConfigured,
} from "../lib/env.server.schema";
import { driverFor } from "../db/driver";
import {
  databaseDiagnostics,
  resolvedEndpoints,
  type Diagnostic,
} from "../lib/env-diagnostics";
import { configStatusFrom } from "../lib/settings/config-status-core";

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

/** Prints diagnostics and fails the run on any error-level one. */
function report(found: Diagnostic[]) {
  for (const entry of found) {
    if (entry.level === "error") failed = true;
    console.log(
      `\n  ${entry.level === "error" ? "ERROR" : "warning"}: ${entry.summary}\n` +
        `    ${entry.detail.replace(/\n/g, "\n    ")}`,
    );
  }
}

const state = (set: boolean) => (set ? "set" : "(unset)");

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

    // Which URL each client actually ends up on. Both the migration path and
    // the analytics client prefer the direct endpoint and fall back silently
    // to DATABASE_URL, which is the fallback the diagnostics below are about.
    const endpoints = resolvedEndpoints(env);
    console.log(
      `  migrations use                ${redact(endpoints.migrations!)}`,
    );
    console.log(
      `  admin analytics use           ${redact(endpoints.analytics!)}`,
    );

    report(databaseDiagnostics(env));
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
    SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,
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
  // Not a secret — it is an address, and it is only ever read.
  console.log(
    `  SUPER_ADMIN_EMAIL             ${env.SUPER_ADMIN_EMAIL ?? "(unset)"}`,
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

heading("Integrations");
try {
  const env = parseServerEnv({
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    CI_NOTIFY_SECRET: process.env.CI_NOTIFY_SECRET,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
  });

  // A literal access: Next.js inlines only literal `process.env.NEXT_PUBLIC_*`
  // reads, and this script shares the name with the app deliberately.
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  console.log(`  NEXT_PUBLIC_VAPID_PUBLIC_KEY  ${state(Boolean(vapidPublic))}`);
  console.log(
    `  VAPID_PRIVATE_KEY             ${state(Boolean(env.VAPID_PRIVATE_KEY))}`,
  );
  console.log(
    `  VAPID_SUBJECT                 ${env.VAPID_SUBJECT ?? "(unset)"}`,
  );
  console.log(
    `  CI_NOTIFY_SECRET              ${state(Boolean(env.CI_NOTIFY_SECRET))}`,
  );
  console.log(
    `  SLACK_WEBHOOK_URL             ${state(Boolean(env.SLACK_WEBHOOK_URL))}`,
  );

  // The allow-list deciding which hosts a lesson image may be served from.
  // Read by `lib/lessons/blocks.ts`; unset means the built-in default.
  console.log(
    `  NEXT_PUBLIC_MEDIA_HOSTS       ${
      process.env.NEXT_PUBLIC_MEDIA_HOSTS ?? "(unset — res.cloudinary.com)"
    }`,
  );

  console.log(
    `\n  web push                      ${
      pushConfigured(env, vapidPublic)
        ? "configured"
        : "not configured (needs all three of the above)"
    }`,
  );
  console.log(
    `  CI alerts                     ${
      ciNotifyConfigured(env)
        ? slackConfigured(env)
          ? "push and Slack"
          : "push only (no Slack webhook)"
        : "disabled (no CI_NOTIFY_SECRET — the endpoint refuses everything)"
    }`,
  );

  // The same computation the admin settings screen shows, so the two cannot
  // disagree about what "configured" means.
  const status = configStatusFrom({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublic,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT,
    SLACK_WEBHOOK_URL: env.SLACK_WEBHOOK_URL,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  });
  console.log(
    `  media uploads (#27)           ${status.cloudinary ? "configured" : "not configured"}`,
  );
  console.log(
    `  outgoing email                ${status.email ? "configured" : "not configured"}`,
  );

  if (Boolean(vapidPublic) !== Boolean(env.VAPID_PRIVATE_KEY)) {
    report([
      {
        level: "warning",
        summary: "Half a VAPID key pair",
        detail:
          "A private key with no public counterpart signs nothing a browser " +
          "will accept, and a public key with no private one cannot send. " +
          "Generate a matched pair with `pnpm vapid:keys`.",
      },
    ]);
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
