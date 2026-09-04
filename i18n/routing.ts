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
