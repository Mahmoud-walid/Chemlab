import { z } from "zod";

import { locales } from "@/i18n/routing";

/**
 * Every setting the platform has, declared once.
 *
 * The registry is the single source of truth for a key's type, default,
 * section, edit permission and whether it is safe to send to a browser.
 * Everything else reads from here: the form, the write action's validation,
 * the permission check, and the fallback when no row exists.
 *
 * Pure — no database, no `server-only` — so the same schemas validate in the
 * browser and on the server, and a test can assert properties of the whole
 * catalogue without a request.
 */

export const SETTING_SECTIONS = ["general", "features"] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];

export interface SettingDefinition<T = unknown> {
  key: string;
  section: SettingSection;
  schema: z.ZodType<T>;
  default: T;
  /**
   * The permission needed to CHANGE it. Resolved from here by the write
   * action, never from a section the client names — otherwise a crafted
   * request updates a security key under a general-section check.
   */
  permission: string;
  /**
   * Safe to send to the browser. Nothing here is a secret, but "not a secret"
   * and "worth shipping in every page's payload" are different questions.
   */
  clientSafe: boolean;
}

function define<T>(
  key: string,
  definition: Omit<SettingDefinition<T>, "key">,
): SettingDefinition<T> {
  return { key, ...definition };
}

const localeEnum = z.enum(locales as unknown as [string, ...string[]]);

export const SETTINGS: SettingDefinition[] = [
  // ── General ───────────────────────────────────────────────────────────────
  // These take over from the NEXT_PUBLIC_* values the root layout reads today.
  // `lib/env.ts` stays the boot-time fallback, so an unconfigured deployment
  // still renders a name rather than an empty title.
  define<string>("general.siteName", {
    section: "general",
    schema: z.string().trim().min(1, "Enter a site name.").max(80),
    default: "Chemlab",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("general.siteDescription", {
    section: "general",
    schema: z.string().trim().min(1, "Enter a description.").max(300),
    default: "Interactive Chemistry Learning for Kids",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("general.defaultLocale", {
    section: "general",
    schema: localeEnum,
    default: "en",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string | null>("general.contactEmail", {
    section: "general",
    schema: z
      .union([
        z.string().trim().email("Enter an email address."),
        z.literal(""),
      ])
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    default: null,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string | null>("general.supportUrl", {
    section: "general",
    schema: z
      .union([z.string().trim().url("Enter a full URL."), z.literal("")])
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    default: null,
    permission: "setting:update",
    clientSafe: true,
  }),

  // ── Features ──────────────────────────────────────────────────────────────
  // Whole-platform switches. The PER-ROUTE open/close switches live in the
  // `pages` table (#16) and are NOT duplicated here: two sources of truth for
  // "is /quiz live" is how a page ends up half-disabled. This screen links to
  // that one.
  define<boolean>("features.registrationOpen", {
    section: "features",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.commentsEnabled", {
    section: "features",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.likesEnabled", {
    section: "features",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.savesEnabled", {
    section: "features",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.examsEnabled", {
    section: "features",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function settingsInSection(
  section: SettingSection,
): SettingDefinition[] {
  return SETTINGS.filter((setting) => setting.section === section);
}

/** Every default, as the shape a reader gets when no row exists. */
export function defaultSettings(): Record<string, unknown> {
  return Object.fromEntries(
    SETTINGS.map((setting) => [setting.key, setting.default]),
  );
}

/**
 * Names that must never appear in this registry.
 *
 * Secrets are environment variables. A secret in this table would be recorded
 * verbatim in the activity stream on every change, rendered in a form, and
 * cached — and it is the ABSENCE of secrets here that makes recording old and
 * new values safe. Asserted by a test rather than left as a convention.
 */
export const SECRET_LOOKING =
  /secret|password|token|api[_-]?key|private|credential/i;
