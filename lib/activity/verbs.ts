/**
 * Everything the platform records that a person did.
 *
 * A closed list, not free text. A verb typed as `lesson.viewd` in one call site
 * makes every downstream count quietly wrong — the query returns fewer rows and
 * nothing says why. Kept here rather than only in the database enum so the
 * seed, the tests and the UI all read the same declaration, and so adding a
 * verb is a migration rather than a string literal.
 *
 * Pure: no database, no `server-only`, so it can be imported anywhere.
 */

export const ACTIVITY_VERBS = [
  // Accounts
  "auth.signed_in",
  "auth.signed_up",
  "auth.signed_out",

  // Learning
  "lesson.viewed",
  "lesson.completed",
  "lesson.liked",
  "lesson.unliked",
  "lesson.saved",
  "lesson.shared",

  // Discussion
  "comment.posted",
  "comment.liked",
  "comment.deleted",

  // Assessment
  "exam.started",
  "exam.submitted",
  "exam.abandoned",

  // Administration — the same changes the audit log records, kept here too so
  // a timeline of "what happened" is not split across two tables to read.
  "admin.created",
  "admin.updated",
  "admin.deleted",
  "admin.published",
  "admin.page_toggled",
  "admin.settings_changed",
  "admin.exported",
] as const;

export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

/** The kinds of thing a verb can be about. */
export const ACTIVITY_OBJECT_TYPES = [
  "user",
  "lesson",
  "quiz",
  "element",
  "page",
  "comment",
  "attempt",
  "role",
  "setting",
  "export",
] as const;

export type ActivityObjectType = (typeof ACTIVITY_OBJECT_TYPES)[number];

/** The resource half of a verb — `lesson.viewed` → `lesson`. */
export function verbGroup(verb: ActivityVerb): string {
  return verb.split(".")[0]!;
}

/** Distinct groups, in declaration order. For the filter menu. */
export function verbGroups(): string[] {
  const seen = new Set<string>();
  for (const verb of ACTIVITY_VERBS) seen.add(verbGroup(verb));
  return [...seen];
}

export function isActivityVerb(value: string): value is ActivityVerb {
  return (ACTIVITY_VERBS as readonly string[]).includes(value);
}
