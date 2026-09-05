/**
 * What may be exported, by whom, and how much of it.
 *
 * Pure — no database, no request — so every limit here can be tested against
 * hand-written numbers rather than inferred from a download.
 *
 * The three datasets are declared in one table because two things have to
 * agree about each of them and must not drift: the route (which permission
 * gates it, what it is called in the filename) and the UI (which button to
 * show). A second list somewhere would be a screen offering a download that
 * 403s.
 */

export const EXPORT_DATASETS = ["attempts", "events", "funnel"] as const;

export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export interface DatasetSpec {
  /** Held to download this dataset at all. */
  permission: string;
  /**
   * Withheld unless the caller also holds this. Personal columns are still
   * omitted from the QUERY, not blanked afterwards — see `db/queries/admin/export.ts`.
   */
  piiPermission?: string;
  /**
   * The cap on rows written. A file, unlike a page, has no "next" link, so an
   * unbounded export is one query away from holding a table in memory and
   * one download away from being the whole database on a laptop.
   */
  maxRows: number;
}

export const DATASETS: Record<ExportDataset, DatasetSpec> = {
  // Sittings and marks. `exam:export` exists in the vocabulary already and has
  // never been checked anywhere — this is what it was seeded for.
  attempts: { permission: "exam:export", maxRows: 50_000 },
  events: {
    permission: "activity:export",
    // Reading the stream on screen and taking it away on a memory stick are
    // different acts with different consequences, so the export needs its own
    // grant AND the on-screen PII grant to include IP addresses.
    piiPermission: "activity:read_pii",
    maxRows: 100_000,
  },
  // Five rows by definition. Capped anyway, so the cap is a property of the
  // route rather than a claim about one dataset's shape.
  funnel: { permission: "activity:export", maxRows: 1_000 },
};

export function isExportDataset(value: string): value is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(value);
}

/**
 * Rate limit: exports per user per window.
 *
 * Scoped to the user rather than the IP: these routes need a session anyway,
 * and an IP bucket would throttle a whole office sharing one address. The
 * limit is deliberately small — an export is a deliberate act, not something
 * a screen does on your behalf, and the failure this prevents is one account
 * pulling the events table repeatedly rather than a burst of honest clicks.
 */
export const EXPORT_WINDOW_MS = 60 * 60 * 1000;
export const EXPORTS_PER_WINDOW = 10;

export interface RateDecision {
  allowed: boolean;
  /** Seconds to put in `Retry-After`. Zero when allowed. */
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Decides from the timestamps of this user's recent exports.
 *
 * Takes the times rather than a count so it can say WHEN the window reopens:
 * "try again later" with no number is an instruction to poll. Callers pass
 * every export they recorded for the user; anything outside the window is
 * ignored here rather than filtered in SQL, so the boundary rule lives in one
 * place and is testable.
 */
export function decideExportRate(
  previousExports: readonly Date[],
  now: Date,
): RateDecision {
  const cutoff = now.getTime() - EXPORT_WINDOW_MS;
  const inWindow = previousExports
    .map((date) => date.getTime())
    .filter((time) => time > cutoff)
    .sort((a, b) => a - b);

  if (inWindow.length < EXPORTS_PER_WINDOW) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: EXPORTS_PER_WINDOW - inWindow.length - 1,
    };
  }

  // The window reopens when the OLDEST export inside it falls out, not a fixed
  // hour from now: a fixed wait would punish someone who exported once an hour
  // ago as if they had exported ten times a second ago.
  const oldest = inWindow[inWindow.length - EXPORTS_PER_WINDOW]!;
  const reopensAt = oldest + EXPORT_WINDOW_MS;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((reopensAt - now.getTime()) / 1000),
    ),
    remaining: 0,
  };
}

/**
 * How many rows the database is asked for at a time while streaming.
 *
 * Not a cosmetic number: the whole point of streaming is that the process
 * never holds the result set, so the batch is what bounds memory. Small
 * enough to stay cheap, large enough that a 50k export is 50 round trips
 * rather than 50,000.
 */
export const EXPORT_BATCH_SIZE = 1_000;
