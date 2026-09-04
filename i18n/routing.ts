import { defineRouting } from "next-intl/routing";

export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Locales that read right-to-left. */
export const rtlLocales: readonly Locale[] = ["ar"];

export function isRtl(locale: string): boolean {
  return rtlLocales.includes(locale as Locale);
}

export function direction(locale: string): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  );
}

/**
 * Resolves the locale for a request.
 *
 * The `[locale]` segment acts as a catch-all, so anything can arrive here —
 * an unknown language, a stray `/unknown.txt`, or nothing at all for a page
 * rendered outside the segment. All of them fall back rather than throwing.
 *
 * Kept pure and separate from `i18n/request.ts` so it is unit-testable without
 * next-intl's server build, and so the profile-locale lookup that arrives with
 * user accounts has an obvious home.
 */
export function resolveLocale(requested: string | undefined): Locale {
  return isSupportedLocale(requested) ? requested : defaultLocale;
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  // English keeps the existing unprefixed URLs (/lessons); Arabic is served
  // from /ar/lessons. Nothing already published breaks, and every page still
  // has a distinct, shareable, indexable URL per locale.
  localePrefix: "as-needed",
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

// Locale-aware navigation lives in `i18n/navigation.ts`. Keeping it out of this
// module means the routing config can be imported anywhere — tests, server
// code, the middleware — without pulling in next/navigation.
