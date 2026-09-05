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

/**
 * What a reader gets when a translation exists but is not simply current.
 *
 * Two policies, because "stale" does not mean the same thing everywhere:
 *
 * - `prose` — a lesson. An out-of-date translation of an article is still
 *   mostly the article, and swapping mid-read to English is more jarring than
 *   useful. It is served with a notice, so the reader can decide.
 * - `assessed` — a quiz question. A stale question is a **wrong question**:
 *   the prompt may no longer match the options it is scored against, and a
 *   banner does not fix a wrong answer. English wins.
 *
 * The distinction is #62's scope §4, and it is the one call in this feature
 * that is about people rather than data.
 */
export type TranslationPolicy = "prose" | "assessed";

export type TranslationChoice =
  /** Show the translation, unqualified. */
  | "translation"
  /** Show the translation, with "this may be out of date" alongside it. */
  | "translation-with-notice"
  /** Show the default-locale copy. */
  | "fallback";

export interface TranslationState {
  /** Whether a row exists for this locale at all. */
  present: boolean;
  /** The workflow status on that row. */
  status?: "draft" | "in_review" | "published" | null;
  /** Whether the source has moved on since the translation was made. */
  stale?: boolean | null;
}

/**
 * The one place that decides whether a reader sees a translation.
 *
 * Deliberately pure and deliberately shared: the alternative is each query
 * remembering three rules, and the first one to forget the status check
 * publishes an unreviewed chemistry translation to every Arabic reader.
 */
export function chooseTranslation(
  state: TranslationState,
  policy: TranslationPolicy,
): TranslationChoice {
  if (!state.present) return "fallback";

  // A draft or an in-review translation is somebody's work in progress. The
  // workflow columns are pointless if a reader sees the draft anyway.
  if (state.status !== "published") return "fallback";

  if (state.stale) {
    return policy === "prose" ? "translation-with-notice" : "fallback";
  }

  return "translation";
}

/** True when the reader should be told the translation may be out of date. */
export function showsStaleNotice(choice: TranslationChoice): boolean {
  return choice === "translation-with-notice";
}

/** True when the reader is being shown the translated copy at all. */
export function usesTranslation(choice: TranslationChoice): boolean {
  return choice !== "fallback";
}

/**
 * The whole rule in one call, for the common case.
 *
 * `pick(base, translated, state, policy)` returns what the reader should see.
 * Presence is derived from the translated value rather than passed in, because
 * a left join that missed IS the absent row — asking each call site to say so
 * again is asking it to get it wrong.
 *
 * Use `chooseTranslation` directly only where the choice itself matters, such
 * as deciding whether to render the out-of-date notice.
 */
export function pick<T>(
  base: T,
  translated: T | null | undefined,
  state: Omit<TranslationState, "present">,
  policy: TranslationPolicy,
): T {
  const choice = chooseTranslation(
    { present: translated !== null && translated !== undefined, ...state },
    policy,
  );
  return usesTranslation(choice) ? preferred(translated, base) : base;
}
