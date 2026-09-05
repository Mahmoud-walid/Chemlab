import { defaultLocale, locales } from "./routing";

/**
 * Every URL one page has, across locales.
 *
 * `localePrefix: "as-needed"` means the same page lives at `/lessons/acids`
 * for English and `/ar/lessons/acids` for Arabic — two distinct cached
 * entries. `revalidatePath("/lessons/acids")` therefore refreshes the English
 * one and leaves the Arabic reader on whatever was rendered before.
 *
 * That is invisible until a change affects both, which content changes always
 * do: an edited English lesson is what an untranslated Arabic page falls back
 * to, and it is also what makes an existing Arabic translation out of date. A
 * notice that only appears after some unrelated rebuild is worse than no
 * notice, because it is a promise the page is not keeping.
 *
 * So content actions revalidate the whole set rather than one path.
 *
 * Pass each of these to `revalidatePath` WITHOUT a type argument. The second
 * argument marks the first as a route PATTERN — `/lessons/[slug]` with
 * `"page"` — and giving it alongside a concrete path makes the call match
 * nothing and do nothing, silently. `tests/e2e/admin-translations.spec.ts`
 * found exactly that: a published translation that never reached the reader.
 */
export function localizedPaths(path: string): string[] {
  return locales.map((locale) =>
    locale === defaultLocale ? path : `/${locale}${path}`,
  );
}
