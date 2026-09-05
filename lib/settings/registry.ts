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

export const SETTING_SECTIONS = [
  "general",
  "features",
  "content",
  "notifications",
  "security",
  "localization",
] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];

/**
 * How a setting is rendered.
 *
 * Declared here rather than derived from the key. A `kindOf(key)` switch in
 * the page grows a branch per key and is unreachable from a test — this is one
 * field the registry test can assert over the whole catalogue.
 */
export const SETTING_KINDS = [
  "text",
  "longText",
  "number",
  "boolean",
  "select",
  "multiSelect",
] as const;

export type SettingKind = (typeof SETTING_KINDS)[number];

export interface SettingDefinition<T = unknown> {
  key: string;
  section: SettingSection;
  kind: SettingKind;
  schema: z.ZodType<T>;
  default: T;
  /**
   * The values a `select` or `multiSelect` offers. Values only — labels are
   * message keys resolved by the page, so a locale never reaches this module.
   */
  options?: readonly string[];
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

/**
 * The OAuth providers the app knows how to speak to.
 *
 * A provider is only ENABLEABLE when its credentials are present in the
 * environment; that check is env-dependent and therefore lives in
 * `lib/settings/config-status.ts`, not here — this module stays pure so the
 * browser can import it.
 */
export const OAUTH_PROVIDERS = ["google"] as const;

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** A whole number in a range, arriving from a form as a string or a number. */
function integer(min: number, max: number, message: string) {
  return z.preprocess(
    // A number input posts a string. Coercing here rather than with
    // `z.coerce.number()` keeps `""` and `"abc"` as failures instead of
    // turning them into 0 and NaN.
    (value) =>
      typeof value === "string" && value.trim() !== "" ? Number(value) : value,
    z.number().int(message).min(min, message).max(max, message),
  );
}

export const SETTINGS: SettingDefinition[] = [
  // ── General ───────────────────────────────────────────────────────────────
  // These take over from the NEXT_PUBLIC_* values the root layout reads today.
  // `lib/env.ts` stays the boot-time fallback, so an unconfigured deployment
  // still renders a name rather than an empty title.
  define<string>("general.siteName", {
    section: "general",
    kind: "text",
    schema: z.string().trim().min(1, "Enter a site name.").max(80),
    default: "Chemlab",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("general.siteDescription", {
    section: "general",
    kind: "longText",
    schema: z.string().trim().min(1, "Enter a description.").max(300),
    default: "Interactive Chemistry Learning for Kids",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("general.defaultLocale", {
    section: "general",
    kind: "select",
    options: locales,
    schema: localeEnum,
    default: "en",
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string | null>("general.contactEmail", {
    section: "general",
    kind: "text",
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
    kind: "text",
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
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.commentsEnabled", {
    section: "features",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.likesEnabled", {
    section: "features",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.savesEnabled", {
    section: "features",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<boolean>("features.examsEnabled", {
    section: "features",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: true,
  }),

  // ── Content ───────────────────────────────────────────────────────────────
  // Defaults applied to NEW records at creation. Nothing here rewrites an
  // existing row: changing the default pass mark must not silently re-grade
  // attempts that were already marked against the old one. The help text on
  // each field says so, because a settings screen that quietly retro-applies
  // is the kind of thing an operator only discovers from a complaint.
  define<number>("content.lessonsPerPage", {
    section: "content",
    kind: "number",
    schema: integer(4, 60, "Choose between 4 and 60."),
    default: 12,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<number>("content.commentsPerPage", {
    section: "content",
    kind: "number",
    schema: integer(5, 100, "Choose between 5 and 100."),
    default: 20,
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("content.defaultDifficulty", {
    section: "content",
    kind: "select",
    options: DIFFICULTIES,
    schema: z.enum(DIFFICULTIES),
    default: "medium",
    permission: "setting:update",
    clientSafe: false,
  }),
  define<number>("content.defaultExamTimeLimitSeconds", {
    section: "content",
    kind: "number",
    // 0 means "no limit" — a distinct, useful state, and the reason the floor
    // is not 60. A one-second exam is not.
    schema: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : value,
      z
        .number()
        .int("Enter a whole number of seconds.")
        .min(0, "Enter 0 for no limit, or at least 60 seconds.")
        .max(14_400, "That is longer than four hours.")
        .refine((seconds) => seconds === 0 || seconds >= 60, {
          message: "Enter 0 for no limit, or at least 60 seconds.",
        }),
    ),
    default: 900,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<number>("content.defaultPassMarkPercent", {
    section: "content",
    kind: "number",
    schema: integer(1, 100, "Choose between 1 and 100."),
    default: 60,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<number>("content.defaultMaxAttempts", {
    section: "content",
    kind: "number",
    // 0 means unlimited, matching the time limit's use of 0.
    schema: integer(0, 50, "Choose between 0 and 50."),
    default: 3,
    permission: "setting:update",
    clientSafe: false,
  }),

  // ── Notifications ─────────────────────────────────────────────────────────
  // Platform DEFAULTS, one key per event, rather than one `notifications
  // .defaults` object. A per-key row is what makes the audit trail readable:
  // "weekly digest turned off by X" instead of a diff of two JSON blobs. The
  // per-USER overrides belong to the Web Push issue (#24) and are not here.
  define<boolean>("notifications.commentReply", {
    section: "notifications",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<boolean>("notifications.examResult", {
    section: "notifications",
    kind: "boolean",
    schema: z.boolean(),
    default: true,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<boolean>("notifications.newLesson", {
    section: "notifications",
    kind: "boolean",
    schema: z.boolean(),
    default: false,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<boolean>("notifications.weeklyDigest", {
    section: "notifications",
    kind: "boolean",
    schema: z.boolean(),
    default: false,
    permission: "setting:update",
    clientSafe: false,
  }),
  define<string | null>("notifications.fromAddress", {
    section: "notifications",
    kind: "text",
    schema: z
      .union([
        z.string().trim().email("Enter an email address."),
        z.literal(""),
      ])
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    default: null,
    permission: "setting:update",
    clientSafe: false,
  }),

  // ── Security ──────────────────────────────────────────────────────────────
  // Guarded by `setting:update_security` rather than `setting:update`: session
  // lifetime, the rate limits and the OAuth provider list are the settings
  // that decide who gets in and how hard it is to try. Someone trusted to
  // rename the site is not automatically trusted to widen those.
  define<number>("security.sessionLifetimeDays", {
    section: "security",
    kind: "number",
    schema: integer(1, 365, "Choose between 1 and 365 days."),
    default: 30,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<number>("security.idleTimeoutMinutes", {
    section: "security",
    kind: "number",
    // 0 means "no idle timeout".
    schema: integer(0, 43_200, "Choose 0 for none, or up to 30 days."),
    default: 0,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<number>("security.rateLimitWindowMinutes", {
    section: "security",
    kind: "number",
    schema: integer(1, 1_440, "Choose between 1 and 1440 minutes."),
    default: 15,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<number>("security.authAttemptsPerWindow", {
    section: "security",
    kind: "number",
    schema: integer(1, 1_000, "Choose between 1 and 1000."),
    default: 10,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<number>("security.commentPostsPerWindow", {
    section: "security",
    kind: "number",
    schema: integer(1, 1_000, "Choose between 1 and 1000."),
    default: 20,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<number>("security.examSubmissionsPerWindow", {
    section: "security",
    kind: "number",
    schema: integer(1, 1_000, "Choose between 1 and 1000."),
    default: 30,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<boolean>("security.requireEmailVerification", {
    section: "security",
    kind: "boolean",
    schema: z.boolean(),
    default: false,
    permission: "setting:update_security",
    clientSafe: false,
  }),
  define<string[]>("security.allowedOAuthProviders", {
    section: "security",
    kind: "multiSelect",
    options: OAUTH_PROVIDERS,
    // The shape is checked here; whether a provider's credentials exist is
    // checked on the server, where `process.env` is.
    schema: z.array(z.enum(OAUTH_PROVIDERS)).max(OAUTH_PROVIDERS.length),
    default: [...OAUTH_PROVIDERS],
    permission: "setting:update_security",
    clientSafe: false,
  }),

  // ── Localisation ──────────────────────────────────────────────────────────
  // `localization.offeredLocales`, NOT `enabledLocales`. The name matters: the
  // locale LIST is a compile-time constant in `i18n/routing.ts` that drives
  // `generateStaticParams`, the proxy's matcher and the message-key types, so
  // there are prerendered Arabic pages that would still answer if a switch
  // here claimed Arabic was off. This key controls where a locale is OFFERED
  // — the language switcher and the `hreflang` links — and says so. A real
  // per-locale kill switch is a routing change, recorded on #23.
  //
  // The default locale is `general.defaultLocale`, shown here read-only rather
  // than declared twice: two keys for one value is how they end up disagreeing.
  define<string[]>("localization.offeredLocales", {
    section: "localization",
    kind: "multiSelect",
    options: locales,
    schema: z
      .array(localeEnum)
      .min(1, "Offer at least one language.")
      .refine((values) => new Set(values).size === values.length, {
        message: "That language is listed twice.",
      }),
    default: [...locales],
    permission: "setting:update",
    clientSafe: true,
  }),
  define<string>("localization.fallbackLocale", {
    section: "localization",
    kind: "select",
    options: locales,
    schema: localeEnum,
    default: "en",
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
