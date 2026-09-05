/**
 * How often one person may post.
 *
 * Three limits, not one, because they stop three different things:
 *
 * - **One per 15 seconds** stops a double-submit and a script hammering the
 *   endpoint.
 * - **A burst of 3** allows the normal case — somebody answering three
 *   questions in a row — without letting the 15-second gap be the only brake.
 * - **Ten per hour** is the one that actually bounds a spam run, since the
 *   other two are satisfied by a patient script.
 *
 * Pure, and takes the recent timestamps rather than reading them, so every
 * boundary is testable without a database or a clock. Enforced server-side in
 * the route: a limit the client applies is a suggestion.
 */

export const MIN_INTERVAL_MS = 15_000;
export const BURST = 3;
export const HOURLY_LIMIT = 10;
export const HOUR_MS = 60 * 60 * 1000;

export type RateRejection = "too-fast" | "hourly-limit" | "duplicate";

export interface RateDecision {
  allowed: boolean;
  reason?: RateRejection;
  /** Milliseconds until the next attempt is permitted. Zero when allowed, so
   * the response can carry an honest `Retry-After` rather than a guess. */
  retryAfterMs: number;
}

const ok: RateDecision = { allowed: true, retryAfterMs: 0 };

/**
 * Decides from the person's own recent comments, newest first.
 *
 * `recentBodies` is checked for an exact repeat within the window: a
 * double-submitted form and a copy-paste spam run look identical from here,
 * and neither should produce two rows. It is a separate rejection from the
 * pace limits because the honest fix differs — "you already said that" rather
 * than "wait a moment".
 */
export function decidePost(
  recent: readonly { createdAt: Date; body: string }[],
  body: string,
  now: Date,
): RateDecision {
  const withinHour = recent.filter(
    (comment) => now.getTime() - comment.createdAt.getTime() < HOUR_MS,
  );

  if (withinHour.some((comment) => comment.body === body)) {
    return { allowed: false, reason: "duplicate", retryAfterMs: 0 };
  }

  if (withinHour.length >= HOURLY_LIMIT) {
    // Until the OLDEST in the window falls out — the window slides, so ten
    // comments an hour ago do not cost a full hour of silence now.
    const oldest = withinHour[withinHour.length - 1]!;
    return {
      allowed: false,
      reason: "hourly-limit",
      retryAfterMs: Math.max(
        0,
        HOUR_MS - (now.getTime() - oldest.createdAt.getTime()),
      ),
    };
  }

  const last = recent[0];
  if (!last) return ok;

  const sinceLast = now.getTime() - last.createdAt.getTime();

  // The burst allowance: the first few in a row skip the interval check, so
  // answering three questions quickly is not treated as an attack.
  const inBurst = recent.filter(
    (comment) => now.getTime() - comment.createdAt.getTime() < MIN_INTERVAL_MS,
  ).length;

  if (inBurst < BURST) return ok;

  if (sinceLast < MIN_INTERVAL_MS) {
    return {
      allowed: false,
      reason: "too-fast",
      retryAfterMs: MIN_INTERVAL_MS - sinceLast,
    };
  }

  return ok;
}

/** Seconds, rounded up — `Retry-After` is an integer, and rounding down tells
 * the client to try again while it is still refused. */
export function retryAfterSeconds(decision: RateDecision): number {
  return Math.ceil(decision.retryAfterMs / 1000);
}
