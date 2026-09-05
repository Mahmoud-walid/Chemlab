import { z } from "zod";

/**
 * Public runtime configuration.
 *
 * Every value is optional and falls back to a working default, so the app runs
 * with no `.env` file at all. Invalid values fail loudly at import time rather
 * than silently producing broken metadata.
 *
 * `NEXT_PUBLIC_*` variables are inlined by Next.js at build time, and only
 * literal `process.env.NEXT_PUBLIC_X` accesses are replaced — a dynamic lookup
 * like `process.env[key]` resolves to `undefined` in the browser bundle. That
 * is why `readEnv()` below spells each variable out.
 */
export const DEFAULT_SITE_URL = "http://localhost:3000";
export const DEFAULT_SITE_NAME = "Chemlab";
export const DEFAULT_SITE_DESCRIPTION =
  "Chemlab is a fun, interactive, and kid-friendly web app to explore chemistry. Learn atoms, molecules, elements, reactions, and take random quizzes—all without an account.";

export const envSchema = z.object({
  /** Canonical origin used for metadataBase, Open Graph and Twitter URLs. */
  NEXT_PUBLIC_SITE_URL: z
    .url({ message: "must be an absolute URL, e.g. https://chemlab.app" })
    .default(DEFAULT_SITE_URL),

  /** Product name shown in metadata and in the UI. */
  NEXT_PUBLIC_SITE_NAME: z
    .string()
    .trim()
    .min(1, { message: "must not be empty" })
    .default(DEFAULT_SITE_NAME),

  /** Meta and Open Graph description. */
  NEXT_PUBLIC_SITE_DESCRIPTION: z
    .string()
    .trim()
    .min(1, { message: "must not be empty" })
    .default(DEFAULT_SITE_DESCRIPTION),

  /** Optional Twitter handle; omitted from metadata when unset. */
  NEXT_PUBLIC_TWITTER_HANDLE: z
    .string()
    .trim()
    .regex(/^@[A-Za-z0-9_]{1,15}$/, {
      message: "must be a handle starting with @, e.g. @ChemlabApp",
    })
    .optional(),

  /**
   * The PUBLIC half of the VAPID pair.
   *
   * This one genuinely has to reach the browser — `PushManager.subscribe()`
   * takes it as `applicationServerKey`, so there is no server-side way to
   * supply it. It is a public key: publishing it lets a browser verify our
   * pushes, not send them. Its private counterpart lives in
   * `lib/env.server.schema.ts` and must never gain this prefix.
   *
   * Base64url, 65 bytes uncompressed — 87 characters. Checked, because a
   * truncated key fails inside `subscribe()` with a DOMException that says
   * nothing about which of the two keys is wrong.
   */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{86,88}$/, {
      message: "must be a base64url VAPID public key (pnpm vapid:keys)",
    })
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Raw values as they arrive from the environment. */
export type EnvInput = Partial<Record<keyof Env, string | undefined>>;

/**
 * Validates raw environment values. Empty strings are treated as "unset" so a
 * blank line in `.env` falls back to the default instead of failing.
 */
export function parseEnv(input: EnvInput): Env {
  const cleaned = Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );

  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

function readEnv(): Env {
  try {
    // Each variable is spelled out so Next.js can inline it — see the note above.
    return parseEnv({
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
      NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
      NEXT_PUBLIC_TWITTER_HANDLE: process.env.NEXT_PUBLIC_TWITTER_HANDLE,
      // Written out literally, like the rest: Next.js only inlines a literal
      // `process.env.NEXT_PUBLIC_X`, so a dynamic lookup would be undefined in
      // the browser and the subscribe call would fail with no explanation.
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    });
  } catch (error) {
    // A throw inside a Next.js build worker is reported as an opaque
    // "Failed to collect page data", so write the real reason out first.
    // `configs/setup-console` silences console.* outside development, which is
    // why this goes straight to stderr.
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(`\n${(error as Error).message}\n\n`);
    }
    throw error;
  }
}

export const env = readEnv();

/** Absolute URL for a path, based on the configured site URL. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}
