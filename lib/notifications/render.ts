import type { NotificationType } from "./types";

/**
 * Turning a stored row into something a person can read.
 *
 * The row carries a type, a count and structured data; this decides which
 * message key and which values render it. Pure, so the mapping can be tested
 * without a database or a locale loaded — and so the message CATALOGUE is the
 * only place the words live.
 *
 * Every key takes a `count`, even where it is always one. ICU chooses the
 * plural form, and Arabic has six categories — zero, one, two, few, many,
 * other — where English has two. A sentence assembled in code with an `if`
 * would get Arabic wrong in four of them, which is the whole reason nothing
 * user-facing is stored.
 */

export interface NotificationView {
  /** A key under `notifications.messages` in the catalogue. */
  key: NotificationType;
  values: {
    /** The most recent actor's display name, or a placeholder. */
    actor: string;
    /** Distinct people. Drives the plural form. */
    count: number;
  };
  /** Where clicking it goes. Locale prefixing is the Link component's job. */
  href: string;
}

export interface NotificationRow {
  type: NotificationType;
  subjectType: string;
  subjectId: string;
  actorCount: number;
  actorName: string | null;
  data: Record<string, unknown>;
}

/**
 * The link a notification resolves to.
 *
 * Returns null when the row points at something that no longer exists — a
 * deleted lesson, a removed comment. The UI renders a tombstone rather than a
 * link, because a notification that 404s the person who clicked it is worse
 * than one that says the thing is gone.
 */
export function hrefFor(row: NotificationRow): string | null {
  const lessonSlug = stringField(row.data, "lessonSlug");
  const quizSlug = stringField(row.data, "quizSlug");
  const commentId = stringField(row.data, "commentId");

  if (lessonSlug) {
    return commentId
      ? `/lessons/${lessonSlug}#comment-${commentId}`
      : `/lessons/${lessonSlug}`;
  }
  if (quizSlug) return `/quiz/${quizSlug}`;
  return null;
}

export function toView(
  row: NotificationRow,
  fallbackActorName: string,
): NotificationView | null {
  const href = hrefFor(row);
  if (!href) return null;

  return {
    key: row.type,
    values: {
      actor: row.actorName ?? fallbackActorName,
      // Never below one: a row exists because somebody did something, and
      // "0 people liked your lesson" is a sentence no plural rule should have
      // to render.
      count: Math.max(1, row.actorCount),
    },
    href,
  };
}

function stringField(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Groups an inbox into days, for the headings the list shows. */
export function groupByDay<T extends { createdAt: Date }>(
  rows: readonly T[],
  now: Date,
): { day: "today" | "yesterday" | "earlier"; rows: T[] }[] {
  const groups: Record<"today" | "yesterday" | "earlier", T[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const row of rows) {
    groups[dayBucket(row.createdAt, now)].push(row);
  }

  return (["today", "yesterday", "earlier"] as const)
    .filter((day) => groups[day].length > 0)
    .map((day) => ({ day, rows: groups[day] }));
}

function dayBucket(at: Date, now: Date): "today" | "yesterday" | "earlier" {
  const days = Math.floor(
    (startOfDay(now).getTime() - startOfDay(at).getTime()) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return "earlier";
}

function startOfDay(at: Date): Date {
  const copy = new Date(at);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** The badge caps at nine: a precise count above that is noise, and a
 * three-digit badge does not fit the bell. */
export function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}
