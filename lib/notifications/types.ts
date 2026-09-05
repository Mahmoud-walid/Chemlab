/**
 * What Chemlab notifies people about — and, just as importantly, what it
 * refuses to.
 *
 * A closed union, not free-form strings. A typo in a type name would create a
 * notification nobody has written copy for, no preference switches off and no
 * query counts; it would look like a working feature and be a dead letter.
 *
 * Pure: no database, no `server-only`. The fan-out worker, the preferences
 * screen and the tests all read the same declaration.
 */

export const NOTIFICATION_TYPES = [
  // Personal — one recipient, the person acted upon.
  "lesson.liked",
  "comment.liked",
  "comment.replied",
  // Broadcast — every opted-in user.
  "lesson.published",
  "exam.published",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Personal or broadcast. This is not a label: it decides who is looked up,
 * whether the fan-out can run inside a request, and how aggressively the
 * category can be muted.
 */
export type Targeting = "personal" | "broadcast";

export interface NotificationSpec {
  targeting: Targeting;
  /** What the `subject_id` points at. Drives aggregation and the deep link. */
  subjectType: "lesson" | "comment" | "quiz";
  /**
   * Whether several actors on the same subject collapse into one row.
   *
   * True for likes: five people liking a comment is ONE notification saying
   * so, not five. False for a reply, because two replies are two things to
   * read and collapsing them would hide one.
   */
  aggregates: boolean;
  /**
   * The default when a user has no preference row. Everything starts on —
   * a notification system nobody has opted into notifies nobody — but the
   * broadcasts are the ones people mute first, so they must be cheap to turn
   * off and must never be per-item spammy.
   */
  defaultOn: boolean;
}

export const NOTIFICATION_SPECS: Record<NotificationType, NotificationSpec> = {
  "lesson.liked": {
    targeting: "personal",
    subjectType: "lesson",
    aggregates: true,
    defaultOn: true,
  },
  "comment.liked": {
    targeting: "personal",
    subjectType: "comment",
    aggregates: true,
    defaultOn: true,
  },
  "comment.replied": {
    targeting: "personal",
    subjectType: "comment",
    // Two replies are two things to read. Collapsing them into "2 people
    // replied" hides one of them behind a count.
    aggregates: false,
    defaultOn: true,
  },
  "lesson.published": {
    targeting: "broadcast",
    subjectType: "lesson",
    aggregates: false,
    defaultOn: true,
  },
  "exam.published": {
    targeting: "broadcast",
    subjectType: "quiz",
    aggregates: false,
    defaultOn: true,
  },
};

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function specFor(type: NotificationType): NotificationSpec {
  return NOTIFICATION_SPECS[type];
}

/** The types a preferences screen offers, in the order it offers them. */
export function personalTypes(): NotificationType[] {
  return NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_SPECS[type].targeting === "personal",
  );
}

export function broadcastTypes(): NotificationType[] {
  return NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_SPECS[type].targeting === "broadcast",
  );
}

/**
 * The structured, LOCALE-FREE payload a row carries.
 *
 * No user-facing English is ever stored. The site is bilingual, and a stored
 * "Sara replied to your comment" is English for ever — wrong the moment the
 * reader's locale is Arabic, and wrong again the moment the copy is reworded.
 * The message is composed at render time from the recipient's locale, which is
 * also why Arabic's `zero`/`two`/`few`/`many` plural forms work at all.
 */
export interface NotificationData {
  /** For the deep link: `/lessons/{slug}`. */
  lessonSlug?: string;
  quizSlug?: string;
  commentId?: string;
  /** A short quotation, for context in the list. Never the whole comment. */
  excerpt?: string;
}

/**
 * The types whose unread rows collapse, as SQL literals.
 *
 * The aggregation index's predicate names these in the migration, and a
 * Postgres `ON CONFLICT ... WHERE` must match that predicate EXACTLY for the
 * arbiter index to be inferred — a near-miss is not a slow path, it is an
 * error at query time. Deriving both the upsert's predicate and the test's
 * expectation from here means the migration is the only hand-written copy,
 * and `tests/lib/notification-types.test.ts` checks it against this.
 */
export function aggregatingTypesSql(): string {
  return NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_SPECS[type].aggregates,
  )
    .map((type) => `'${type}'`)
    .join(", ");
}

/** The full predicate, shared by the upsert and the index. */
export function aggregationPredicate(): string {
  return `read_at is null and type in (${aggregatingTypesSql()})`;
}
