import { defaultLocale, locales, type Locale } from "@/i18n/routing";

/**
 * Which locale the admin lists' translation column is about.
 *
 * There is exactly one non-default locale today, so the column is singular
 * and this returns it. #62 puts a third locale out of scope deliberately —
 * when one arrives, the lists want a column each rather than a single "worst
 * across all locales" summary, because an editor's next action depends on
 * WHICH language is behind.
 *
 * Returns undefined if the default locale is ever the only one configured,
 * in which case the column is not rendered at all rather than showing a
 * question nobody asked.
 */
export function translationTargetLocale(): Locale | undefined {
  return locales.find((locale) => locale !== defaultLocale);
}
