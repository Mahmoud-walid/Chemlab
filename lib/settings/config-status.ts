import "server-only";

import {
  configStatusFrom,
  configuredOAuthProviders as computeProviders,
  type ConfigStatus,
} from "./config-status-core";

/**
 * The `process.env` reader.
 *
 * `server-only` is doing real work here. Next.js inlines only literal
 * `process.env.NEXT_PUBLIC_*` accesses, so every variable below resolves to
 * `undefined` in a browser bundle — a client import would not leak a secret,
 * it would quietly report everything as unconfigured, which is worse than a
 * crash because it looks like an answer.
 */
function readEnv() {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    // A LITERAL access, because Next.js only inlines literal
    // `process.env.NEXT_PUBLIC_*` reads — a computed key would be undefined.
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
}

/** Booleans only. Read on every call: the environment can change on restart. */
export function configStatus(): ConfigStatus {
  return configStatusFrom(readEnv());
}

/** The providers whose credentials are actually present. */
export function configuredOAuthProviders(): string[] {
  return computeProviders(readEnv());
}

export {
  CONFIG_TARGETS,
  type ConfigStatus,
  type ConfigTarget,
} from "./config-status-core";
