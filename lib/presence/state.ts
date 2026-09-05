import { AWAY_WINDOW_MS, ONLINE_WINDOW_MS } from "./constants";

/**
 * Presence is DERIVED, never stored.
 *
 * A persisted `is_online` boolean goes stale the moment a browser closes
 * without a clean disconnect — which is the common case, not the edge one.
 * Deriving it from a timestamp means a crashed tab, a lost connection and a
 * closed laptop all resolve correctly with no cleanup job.
 *
 * `unknown` is a first-class state, and the reason is honesty: when the
 * presence store cannot be reached, presence is ABSENT rather than offline.
 * Rendering a grey "offline" dot because a query timed out is a claim about
 * somebody that we have no basis for.
 */
export type PresenceState = "online" | "away" | "offline" | "unknown";

export function presenceFrom(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): PresenceState {
  if (!lastSeenAt) return "offline";

  const seen =
    typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const age = now.getTime() - seen.getTime();

  // A timestamp we cannot read is not evidence of absence.
  if (Number.isNaN(age)) return "unknown";
  // Clock skew between the browser and the database can put `last_seen_at`
  // slightly in the future. Somebody who reported in one second from now is
  // emphatically online.
  if (age < 0) return "online";

  if (age < ONLINE_WINDOW_MS) return "online";
  if (age < AWAY_WINDOW_MS) return "away";
  return "offline";
}

/** Whether a dot should be drawn at all. `unknown` renders nothing — see
 * above. */
export function isVisibleState(state: PresenceState): boolean {
  return state !== "unknown";
}

/** The next heartbeat delay, jittered. Exported so the schedule is testable
 * without waiting a minute. */
export function nextBeatMs(
  base: number,
  jitter: number,
  random: () => number = Math.random,
): number {
  // Centred on `base`: ±jitter, not 0..+jitter, or the average interval drifts
  // longer than intended and the window stops matching it.
  const spread = base * jitter;
  return Math.round(base - spread + random() * spread * 2);
}
