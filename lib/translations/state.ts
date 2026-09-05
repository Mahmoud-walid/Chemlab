/**
 * How complete a translation is, as one word an editor can scan a column for.
 *
 * The five states are ordered by how far they are from done, and the order is
 * the point: a lesson is only as translated as its least translated part. An
 * article whose summary is in Arabic while section four is still English is
 * not "translated" — and a column that says it is would be the same
 * looks-correct failure the whole of #62 exists to stop.
 *
 * Kept pure and separate from the query so the ladder can be tested without a
 * database, and so the SQL and the UI cannot disagree about what "stale"
 * outranks.
 */
export const TRANSLATION_STATES = [
  /** Nothing at all for this locale, or some part of it is untranslated. */
  "missing",
  /** Somebody has started. Readers are still served the default locale. */
  "draft",
  /** Written and waiting for somebody else to check it. */
  "in_review",
  /** Published, but the source has moved on since. */
  "stale",
  /** Published and current. */
  "published",
] as const;

export type TranslationState = (typeof TRANSLATION_STATES)[number];

/**
 * Rank, worst first. Shared with the SQL that computes it — `greatest()` over
 * these numbers is how one query answers for a lesson and all of its sections
 * at once, and how the "missing" and "stale" filters narrow to a single value
 * without re-deriving the ladder.
 */
export const TRANSLATION_RANK: Record<TranslationState, number> = {
  missing: 4,
  draft: 3,
  in_review: 2,
  stale: 1,
  published: 0,
};

const BY_RANK = new Map<number, TranslationState>(
  TRANSLATION_STATES.map((state) => [TRANSLATION_RANK[state], state]),
);

/** The state a rank stands for. Unknown ranks read as `published`. */
export function stateFromRank(rank: number): TranslationState {
  return BY_RANK.get(rank) ?? "published";
}

/** The rank a state carries, for a filter that arrives as a query string. */
export function rankFromState(value: string): number | undefined {
  return value in TRANSLATION_RANK
    ? TRANSLATION_RANK[value as TranslationState]
    : undefined;
}

/** True for a value that is one of the five. */
export function isTranslationState(value: unknown): value is TranslationState {
  return (
    typeof value === "string" &&
    (TRANSLATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * The worst of several parts.
 *
 * An empty list is `published` rather than `missing`: a lesson with no
 * sections has nothing left untranslated, and calling that "missing" would
 * put every summary-only lesson in the missing filter forever.
 */
export function worstOf(states: TranslationState[]): TranslationState {
  return states.reduce<TranslationState>(
    (worst, state) =>
      TRANSLATION_RANK[state] > TRANSLATION_RANK[worst] ? state : worst,
    "published",
  );
}

/** Whether this state means a reader is currently served the translation. */
export function isServedToReaders(state: TranslationState): boolean {
  // `stale` included: a stale LESSON is still served, with a notice. Whether
  // a given surface serves it is `db/queries/_locale.ts`'s call, not this
  // module's — this only says the translation is live rather than in
  // progress.
  return state === "published" || state === "stale";
}

/** Whether an editor needs to do something about it. */
export function needsAttention(state: TranslationState): boolean {
  return state !== "published";
}
