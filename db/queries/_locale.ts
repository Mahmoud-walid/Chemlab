import "server-only";

/**
 * Content is stored with a default-locale copy on the base table and other
 * locales in side-car translation tables. Every read therefore needs the same
 * "use the translation if there is one, otherwise fall back" rule, and doing
 * it at each call site is how one page ends up showing English while its
 * neighbour shows Arabic.
 *
 * A missing translation is an ABSENT ROW, not a null column, so the fallback
 * is a left join plus a coalesce rather than a null check nobody remembers.
 */
export const DEFAULT_LOCALE = "en";

/** Picks the translated value when present, otherwise the base-table one. */
export function preferred<T>(translated: T | null | undefined, base: T): T {
  return translated ?? base;
}
