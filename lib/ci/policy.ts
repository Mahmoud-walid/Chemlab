import type { CiOutcome } from "./payload";

/**
 * Who hears about a CI run, and when.
 *
 * The whole value of this feature is that the channel stays worth reading. On
 * an active repository the workflow runs on every push and every pull-request
 * sync, so "notify on every green" means dozens of "✅ it worked" messages a
 * day carrying no information — and a channel you have learned to ignore is
 * one where you also ignore the failures, which defeats the point entirely.
 *
 * Silence is the correct signal for a healthy build. The one exception is the
 * first green after a red: when `main` is broken, the thing you actually want
 * to know is that it is fixed.
 *
 * Pure, and tested against every combination, because this is the logic whose
 * bugs are invisible: a policy that quietly notifies nobody looks exactly like
 * a repository whose build never breaks.
 */

/** What a developer asked for. An absent row means no CI notifications ever —
 * this is opt-in, and having admin rights must not conscript anybody into
 * build noise. */
export interface CiPreferences {
  enabled: boolean;
  /**
   * Branches to hear about. `["*"]` is every branch; the default is `main`
   * alone, because a red `main` is the emergency and everything else is opt-in
   * on top of it.
   */
  branches: string[];
  notifyOnFailure: boolean;
  successPolicy: "never" | "recovery" | "always";
  notifyOnCancelled: boolean;
}

export const DEFAULT_CI_PREFERENCES: CiPreferences = {
  enabled: false,
  branches: ["main"],
  notifyOnFailure: true,
  successPolicy: "recovery",
  notifyOnCancelled: false,
};

export type SuppressionReason =
  | "not-opted-in"
  | "branch-not-watched"
  | "success-not-a-recovery"
  | "success-muted"
  | "failure-muted"
  | "cancellation-muted";

export interface NotifyDecision {
  notify: boolean;
  /** Null when notifying. Recorded on the run row otherwise, so "why did
   * nobody get told?" is answerable from the database rather than by
   * re-reading this file. */
  reason: SuppressionReason | null;
  /** True when this is the first green after a red — the message says
   * "back to green" rather than "passed". */
  recovery: boolean;
}

/**
 * Does this branch match the watch list?
 *
 * `*` alone means everything. A trailing `/*` matches a prefix, so
 * `feat/*` covers `feat/anything` — but not `feat` itself, which is a
 * different branch and not what somebody watching a prefix asked for.
 */
export function watchesBranch(branches: string[], branch: string): boolean {
  return branches.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith("/*")) {
      return branch.startsWith(pattern.slice(0, -1));
    }
    return pattern === branch;
  });
}

/**
 * Whether this run reaches this person.
 *
 * `previousOutcome` is the last recorded outcome for the same
 * (repository, branch) — null when this is the first run we have seen, which
 * is treated as "no red to recover from" rather than as a recovery, or every
 * repository would announce itself once for no reason.
 */
export function decideNotify(
  outcome: CiOutcome,
  previousOutcome: CiOutcome | null,
  branch: string,
  preferences: CiPreferences,
): NotifyDecision {
  const quiet = (reason: SuppressionReason): NotifyDecision => ({
    notify: false,
    reason,
    recovery: false,
  });

  if (!preferences.enabled) return quiet("not-opted-in");
  if (!watchesBranch(preferences.branches, branch)) {
    return quiet("branch-not-watched");
  }

  if (outcome === "failure") {
    // Consecutive failures all notify: each is a different commit with a
    // different cause, and the second one is not less broken than the first.
    return preferences.notifyOnFailure
      ? { notify: true, reason: null, recovery: false }
      : quiet("failure-muted");
  }

  if (outcome === "cancelled") {
    // Off by default: usually a human pressing cancel or a superseded PR run,
    // not a defect.
    return preferences.notifyOnCancelled
      ? { notify: true, reason: null, recovery: false }
      : quiet("cancellation-muted");
  }

  const recovery =
    previousOutcome === "failure" || previousOutcome === "cancelled";

  switch (preferences.successPolicy) {
    case "always":
      return { notify: true, reason: null, recovery };
    case "never":
      return quiet("success-muted");
    case "recovery":
      return recovery
        ? { notify: true, reason: null, recovery: true }
        : quiet("success-not-a-recovery");
  }
}
