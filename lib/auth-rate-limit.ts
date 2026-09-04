import { createHash } from "node:crypto";

/**
 * Rate-limit policy for credential authentication, kept pure so it can be
 * tested without a database or a clock.
 */

/** Identifiers are stored hashed: this table must never become a list of
 * everyone who has tried to sign in, nor leak an address the user never
 * published. A fixed salt per deployment would be better still; the secret is
 * not available here, so the hash is one-way but not keyed — enough to stop a
 * dump from being a mailing list. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Attempts allowed in the window before lockout, then how long the lockout
 * lasts. Exponential: each additional failure past the threshold doubles the
 * wait, capped so a determined attacker cannot lock an account out forever.
 */
export const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 60 * 1000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

export interface LimitDecision {
  allowed: boolean;
  /** Milliseconds until the next attempt is permitted. Zero when allowed. */
  retryAfterMs: number;
}

/**
 * Decides from the recent failure count alone.
 *
 * Successes are not counted: a correct password should not be punished
 * because someone else guessed wrong at the same address. Callers therefore
 * pass only the failures inside the window.
 */
export function decide(failuresInWindow: number): LimitDecision {
  if (failuresInWindow < MAX_ATTEMPTS) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const over = failuresInWindow - MAX_ATTEMPTS;
  const lockout = Math.min(BASE_LOCKOUT_MS * 2 ** over, MAX_LOCKOUT_MS);
  return { allowed: false, retryAfterMs: lockout };
}

/** Whether a recorded attempt still counts, given the window. */
export function withinWindow(attemptedAt: Date, now: Date): boolean {
  return now.getTime() - attemptedAt.getTime() < WINDOW_MS;
}
