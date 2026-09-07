import { OAUTH_PROVIDERS } from "./registry";

/**
 * What is configured, derived from the PRESENCE of environment variables.
 *
 * Never the value, never a masked prefix, never a length: those are all
 * partial disclosures of a secret, and a length is enough to distinguish two
 * candidate keys. A boolean is the whole of what an operator needs — "is
 * Google sign-in going to work" — and the whole of what this may say.
 *
 * The one exception is the VAPID PUBLIC key, which is public by design: every
 * browser that subscribes to push receives it. It still is not surfaced here;
 * the Web Push issue (#24) owns showing it, at the point where it is used.
 *
 * Free of `server-only` so `pnpm env:check` and unit tests can call it with a
 * fabricated environment — the `process.env` reader that must not reach a
 * browser lives in `config-status.ts`.
 */

export interface ConfigStatusInput {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * The PUBLIC half carries the `NEXT_PUBLIC_` prefix, because every
   * subscribing browser needs it — see `lib/env.ts`. Reading an unprefixed
   * `VAPID_PUBLIC_KEY` here made this screen wrong in both directions: it
   * reported "not configured" for a deployment where push worked, and
   * "configured" for one following the old `.env.example`, where it did not.
   */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /**
   * Required by the VAPID spec. A key pair with no subject is a 400 at send
   * time, which is not "partly working" — `pushConfigured()` in
   * `lib/env.server.schema.ts` takes the same view, and this screen must
   * agree with it or one of them is lying.
   */
  VAPID_SUBJECT?: string;
  SLACK_WEBHOOK_URL?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_UPLOAD_FOLDER?: string;
  RESEND_API_KEY?: string;
}

/** The things a settings screen reports as configured or not. */
export const CONFIG_TARGETS = [
  "googleOAuth",
  "webPush",
  "slack",
  "cloudinary",
  "email",
] as const;

export type ConfigTarget = (typeof CONFIG_TARGETS)[number];

export type ConfigStatus = Record<ConfigTarget, boolean>;

const present = (value: string | undefined) =>
  typeof value === "string" && value.trim() !== "";

/**
 * Half a credential counts as NOT configured.
 *
 * A client id without its secret fails at the OAuth callback with an error
 * that reads like a bug in the app. Reporting it as configured is how someone
 * spends an afternoon on the wrong problem.
 */
export function configStatusFrom(env: ConfigStatusInput): ConfigStatus {
  return {
    googleOAuth:
      present(env.GOOGLE_CLIENT_ID) && present(env.GOOGLE_CLIENT_SECRET),
    webPush:
      present(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) &&
      present(env.VAPID_PRIVATE_KEY) &&
      present(env.VAPID_SUBJECT),
    slack: present(env.SLACK_WEBHOOK_URL),
    // All FOUR, the folder included. Without an environment prefix the sign
    // endpoint has nothing to sign a folder as, and reporting "configured"
    // sends somebody looking for the problem everywhere except the variable
    // that is actually missing — the same failure the Web Push row had.
    cloudinary:
      present(env.CLOUDINARY_CLOUD_NAME) &&
      present(env.CLOUDINARY_API_KEY) &&
      present(env.CLOUDINARY_API_SECRET) &&
      present(env.CLOUDINARY_UPLOAD_FOLDER),
    email: present(env.RESEND_API_KEY),
  };
}

/**
 * The OAuth providers that COULD be enabled, given the environment.
 *
 * The settings screen may not enable a provider whose credentials are absent:
 * the button would appear and the sign-in would fail. This is the list the
 * write action checks a submission against.
 */
export function configuredOAuthProviders(env: ConfigStatusInput): string[] {
  const status = configStatusFrom(env);
  return OAUTH_PROVIDERS.filter((provider) =>
    provider === "google" ? status.googleOAuth : false,
  );
}
