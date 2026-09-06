/**
 * When a row may be erased rather than withdrawn.
 *
 * Soft delete is the default and stays the default: `deleted_at` keeps the
 * row, its history and everything pointing at it. Hard delete is the escape
 * hatch for a row created by mistake — a lesson somebody made while learning
 * the editor, which nobody has read and nothing refers to.
 *
 * The refusals are therefore not a safety net bolted on afterwards; they are
 * the definition. A row that was ever published, or that anything refers to,
 * is not a mistake — it is history, and history gets withdrawn.
 *
 * Each reason is a KEY, not a sentence: the admin panel is bilingual and a
 * server action has no business choosing which language an operator reads.
 */

export const HARD_DELETE_REASONS = [
  /** Live right now. Withdraw it first, deliberately, as a separate act. */
  "published",
  /**
   * Live at some point. `published_at` survives a withdrawal, and that is the
   * whole reason it is checked separately: a row that readers have seen has
   * left traces this delete cannot reach — a bookmark, a link, somebody's
   * memory of a URL that now 404s rather than saying the lesson was removed.
   */
  "wasPublished",
  /** Somebody wrote something under it. */
  "hasComments",
  /** Somebody saved or liked it. */
  "hasEngagement",
  /** It appears in the activity stream, which is an audit surface. */
  "hasActivity",
  /** Somebody sat it. */
  "hasAttempts",
] as const;

export type HardDeleteReason = (typeof HARD_DELETE_REASONS)[number];

/** What the database knows about one row, for this decision only. */
export interface HardDeleteState {
  status: "draft" | "published" | "archived";
  publishedAt: Date | null;
  comments: number;
  engagement: number;
  activity: number;
  attempts: number;
}

/**
 * Every reason this row may not be erased, in the order a person would want
 * to hear them.
 *
 * All of them, not the first: an operator who clears one blocker and is then
 * told about the next has been made to discover the rules one round trip at
 * a time.
 */
export function hardDeleteRefusals(state: HardDeleteState): HardDeleteReason[] {
  const reasons: HardDeleteReason[] = [];

  if (state.status === "published") reasons.push("published");
  // Checked even when the status is now draft or archived: `published_at`
  // records that readers once saw this, and withdrawing does not unsee it.
  if (state.publishedAt !== null) reasons.push("wasPublished");

  if (state.comments > 0) reasons.push("hasComments");
  if (state.engagement > 0) reasons.push("hasEngagement");
  if (state.activity > 0) reasons.push("hasActivity");
  if (state.attempts > 0) reasons.push("hasAttempts");

  return reasons;
}

/** True when the row is a mistake rather than history. */
export function canHardDelete(state: HardDeleteState): boolean {
  return hardDeleteRefusals(state).length === 0;
}
