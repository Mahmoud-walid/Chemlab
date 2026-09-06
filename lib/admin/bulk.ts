/**
 * Applying one action to several rows.
 *
 * Two rules from #64, and the interesting part is how they interact:
 *
 * > A bulk action is one transaction: either every selected row changes or
 * > none does, with one audit entry per row.
 *
 * > A bulk action that cannot apply to some rows says which, rather than
 * > skipping them silently.
 *
 * Read together, that means a refusal **aborts the whole batch**. An operator
 * who asks for forty rows and gets thirty-seven with a cheerful toast has to
 * work out which three, from a list they can no longer see. Refusing the lot
 * and naming the offenders lets them deselect and try again — and it is what
 * "either every selected row changes or none does" actually says.
 *
 * A row already in the target state is NOT a refusal. Archiving forty lessons
 * of which one is already archived is a request that can be honoured
 * completely; blocking it would make the strict rule useless in practice. It
 * is reported as unchanged so the counts add up, and it is not written.
 */

/** Why one row cannot take part. */
export type BulkRefusalReason =
  /** The row is gone, or was never the caller's to act on. */
  | "missing"
  /** A rule of the domain forbids it, e.g. publishing an empty lesson. */
  | "blocked";

export interface BulkRefusal {
  id: string;
  /** What to call the row in the message. A slug or title, never the id. */
  label: string;
  reason: BulkRefusalReason;
  /**
   * Which rules the row broke, as message KEYS — never prose.
   *
   * The admin panel is bilingual, and a server action has no business
   * deciding which language an operator reads. These are the same
   * `PublishBlocker` keys the single-row path already surfaces, so the two
   * refusals read identically.
   */
  detail?: string[];
}

export interface BulkPlan {
  /** Rows to write. */
  apply: string[];
  /** Rows already in the target state. Honoured, not written, counted. */
  unchanged: string[];
  /** Rows that stop the whole batch. */
  refused: BulkRefusal[];
}

export interface BulkCandidate {
  id: string;
  label: string;
}

export interface BulkResult {
  /** False when nothing was written, for any reason. */
  ok: boolean;
  applied: number;
  unchanged: number;
  refused: BulkRefusal[];
  /** Set when the whole request failed for a reason that is not per-row. */
  problem?: string;
}

/**
 * Sorts the selected rows into what to write, what to leave, and what stops
 * the batch.
 *
 * `found` is what the database actually returned. Anything selected that is
 * not in it is `missing` — deleted by somebody else, or an id that was never
 * the caller's. Silently dropping those would let a stale selection quietly
 * shrink the action.
 */
export function planBulk<TRow extends BulkCandidate>(
  selected: string[],
  found: TRow[],
  decide: (row: TRow) => { skip?: boolean; refuse?: string[] },
): BulkPlan {
  const byId = new Map(found.map((row) => [row.id, row]));
  const plan: BulkPlan = { apply: [], unchanged: [], refused: [] };

  // Deduplicated, and in the order the caller sent them so the message reads
  // in the order the operator ticked the boxes.
  for (const id of [...new Set(selected)]) {
    const row = byId.get(id);
    if (!row) {
      plan.refused.push({ id, label: id, reason: "missing" });
      continue;
    }

    const verdict = decide(row);
    if (verdict.refuse && verdict.refuse.length > 0) {
      plan.refused.push({
        id,
        label: row.label,
        reason: "blocked",
        detail: verdict.refuse,
      });
    } else if (verdict.skip) {
      plan.unchanged.push(id);
    } else {
      plan.apply.push(id);
    }
  }

  return plan;
}

/** True when the plan may be written at all. */
export function isWritable(plan: BulkPlan): boolean {
  return plan.refused.length === 0;
}

/** The result of a plan that was refused before anything was written. */
export function refusedResult(plan: BulkPlan): BulkResult {
  return {
    ok: false,
    applied: 0,
    unchanged: 0,
    refused: plan.refused,
  };
}

/**
 * The most rows one request may carry.
 *
 * Not a UI limit — the browser can send whatever it likes, so this is checked
 * on the server. A bulk action is one transaction, and a transaction over ten
 * thousand rows holds locks for as long as it takes; the cap keeps "select
 * all" from becoming an outage.
 */
export const MAX_BULK_ROWS = 200;

/** True when a request is small enough to run as one transaction. */
export function withinLimit(selected: string[]): boolean {
  return new Set(selected).size <= MAX_BULK_ROWS;
}
