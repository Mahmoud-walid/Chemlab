import { specFor, type NotificationType } from "./types";

/**
 * Who gets notified, and when the push may go out.
 *
 * Pure, and tested exhaustively, because #21 asks for these to be
 * *implemented* rather than documented — every one of them is a rule that
 * looks obvious in prose and is quietly missing in most notification systems.
 *
 * The distinction that runs through all of it: **muting stops DELIVERY, never
 * the record.** A row is written whatever the preferences say, because the
 * in-app centre is the source of truth and a push is an accelerator. A user
 * who muted email-style noise still needs to be able to find out that somebody
 * replied to them.
 */

export interface Preferences {
  /** Per category. A missing key means the platform default. */
  categories: Partial<Record<NotificationType, boolean>>;
  pushEnabled: boolean;
  /** A global mute with an end. Null means not muted. */
  mutedUntil: Date | null;
  /** Local minutes from midnight. Null disables quiet hours. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  /** IANA zone. Quiet hours are meaningless without one. */
  timezone: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  categories: {},
  pushEnabled: true,
  mutedUntil: null,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: "UTC",
};

/**
 * The first rule, and the one whose absence is most embarrassing: **never
 * notify somebody about their own action.**
 *
 * Checked before the row is written, not before the push — a row saying "you
 * liked your own lesson" is as wrong as a buzz saying it.
 */
export function isSelfAction(
  actorId: string | null,
  recipientId: string,
): boolean {
  return actorId !== null && actorId === recipientId;
}

/** Whether a row should be written at all. */
export function shouldRecord(
  type: NotificationType,
  actorId: string | null,
  recipientId: string,
): boolean {
  if (isSelfAction(actorId, recipientId)) return false;
  // Everything else is recorded. Preferences gate the push, not the record.
  void type;
  return true;
}

export interface PushDecision {
  /** Send it. */
  send: boolean;
  /** When a deferred push becomes due. Null when sending now or not at all. */
  deferUntil: Date | null;
  /** Why, for the log and for the tests. */
  reason:
    | "sent"
    | "category-muted"
    | "push-disabled"
    | "globally-muted"
    | "quiet-hours";
}

/**
 * Whether — and when — the push may be delivered.
 *
 * Quiet hours DEFER rather than drop. A notification suppressed at 3 a.m. and
 * never sent is a notification the user simply did not get; one that arrives
 * when the window ends is the thing they asked for. That distinction is the
 * difference between a quiet-hours feature and a lossy one.
 */
export function decidePush(
  type: NotificationType,
  preferences: Preferences,
  now: Date,
): PushDecision {
  const enabled = preferences.categories[type] ?? specFor(type).defaultOn;

  if (!enabled) {
    return { send: false, deferUntil: null, reason: "category-muted" };
  }

  if (!preferences.pushEnabled) {
    return { send: false, deferUntil: null, reason: "push-disabled" };
  }

  if (preferences.mutedUntil && preferences.mutedUntil > now) {
    // Dropped, not deferred: a global mute is "leave me alone", and a queue
    // that discharges the moment it lifts is the opposite of that.
    return { send: false, deferUntil: null, reason: "globally-muted" };
  }

  const until = quietHoursEnd(preferences, now);
  if (until) {
    return { send: false, deferUntil: until, reason: "quiet-hours" };
  }

  return { send: true, deferUntil: null, reason: "sent" };
}

/**
 * When the current quiet window ends, or null if we are not in one.
 *
 * Computed in the USER's timezone. A quiet-hours feature that evaluates in the
 * server's zone is a feature that wakes people at 3 a.m. in every timezone but
 * one — and it looks correct in every test written by someone in that zone.
 */
export function quietHoursEnd(
  preferences: Preferences,
  now: Date,
): Date | null {
  const { quietHoursStart: start, quietHoursEnd: end } = preferences;
  if (start === null || end === null) return null;
  // An empty window is not quiet hours; treating it as "always" would silence
  // everything for ever from one mis-set field.
  if (start === end) return null;

  const minutes = localMinutes(now, preferences.timezone);
  const inside =
    start < end
      ? minutes >= start && minutes < end
      : // A window that crosses midnight — 22:00 to 07:00 — is the normal
        // case, and the one a naive `start <= x < end` gets wrong.
        minutes >= start || minutes < end;

  if (!inside) return null;

  const minutesUntilEnd = (end - minutes + 1440) % 1440;
  return new Date(now.getTime() + minutesUntilEnd * 60_000);
}

/** Minutes since local midnight, in an IANA zone. */
export function localMinutes(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);

    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(
      parts.find((part) => part.type === "minute")?.value ?? 0,
    );
    // `24` appears for midnight in some ICU versions.
    return ((hour % 24) * 60 + minute) % 1440;
  } catch {
    // An unknown zone must not silence a user's notifications for ever, which
    // is what throwing here would do once the error was swallowed upstream.
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

/**
 * The dedup key a push carries, so the OS tray REPLACES rather than stacks.
 *
 * Same shape as the aggregation key, deliberately: an aggregated row and its
 * push must collapse together, or the tray shows "1 person liked" beside
 * "5 people liked" for the same comment.
 */
export function pushTag(type: NotificationType, subjectId: string): string {
  return `${type}:${subjectId}`;
}

/**
 * Broadcasts are rate limited per category.
 *
 * Publishing ten lessons in a batch import must not produce ten broadcasts to
 * every user on the platform. The cooldown is generous because the failure it
 * prevents is severe: the fastest way to have every user mute a category for
 * ever is to send them ten of it in a minute.
 */
export const BROADCAST_COOLDOWN_MS = 60 * 60 * 1000;

export function broadcastAllowed(
  lastBroadcastAt: Date | null,
  now: Date,
): boolean {
  if (!lastBroadcastAt) return true;
  return now.getTime() - lastBroadcastAt.getTime() >= BROADCAST_COOLDOWN_MS;
}
