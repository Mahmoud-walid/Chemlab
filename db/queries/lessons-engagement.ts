import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { lessons } from "@/db/schema/content";
import { lessonLikes, lessonSaves, shareEvents } from "@/db/schema/engagement";
import type { ShareChannel } from "@/lib/share/share-lesson";

/**
 * Liking, saving and sharing a lesson.
 *
 * Every write here is idempotent by construction rather than by checking
 * first: `on conflict do nothing` against a composite primary key cannot race,
 * where "select, then insert if absent" has a window in which two concurrent
 * requests both see nothing and both insert.
 *
 * The counters on `lessons` are NOT maintained here. They are maintained by
 * database triggers, so they change in the same transaction as the row and so
 * that a cascade delete — which bypasses application code entirely — still
 * moves them. See the migration for the trigger bodies.
 */

export interface EngagementState {
  likeCount: number;
  saveCount: number;
  shareCount: number;
  /** Null when nobody is signed in: "not liked" and "not signed in" are
   * different states, and the UI shows a sign-in prompt for the second. */
  likedByViewer: boolean | null;
  savedByViewer: boolean | null;
}

export async function getEngagement(
  lessonId: string,
  userId: string | null,
): Promise<EngagementState> {
  const db = getDb();

  const [counts] = await db
    .select({
      likeCount: lessons.likeCount,
      saveCount: lessons.saveCount,
      shareCount: lessons.shareCount,
    })
    .from(lessons)
    .where(eq(lessons.id, lessonId));

  if (!userId) {
    return {
      likeCount: counts?.likeCount ?? 0,
      saveCount: counts?.saveCount ?? 0,
      shareCount: counts?.shareCount ?? 0,
      likedByViewer: null,
      savedByViewer: null,
    };
  }

  const [liked] = await db
    .select({ present: sql<number>`1` })
    .from(lessonLikes)
    .where(
      and(eq(lessonLikes.lessonId, lessonId), eq(lessonLikes.userId, userId)),
    );

  const [saved] = await db
    .select({ present: sql<number>`1` })
    .from(lessonSaves)
    .where(
      and(eq(lessonSaves.lessonId, lessonId), eq(lessonSaves.userId, userId)),
    );

  return {
    likeCount: counts?.likeCount ?? 0,
    saveCount: counts?.saveCount ?? 0,
    shareCount: counts?.shareCount ?? 0,
    likedByViewer: liked !== undefined,
    savedByViewer: saved !== undefined,
  };
}

export async function likeLesson(
  lessonId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .insert(lessonLikes)
    .values({ lessonId, userId })
    .onConflictDoNothing();
}

export async function unlikeLesson(
  lessonId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .delete(lessonLikes)
    .where(
      and(eq(lessonLikes.lessonId, lessonId), eq(lessonLikes.userId, userId)),
    );
}

export async function saveLesson(
  lessonId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .insert(lessonSaves)
    .values({ lessonId, userId })
    .onConflictDoNothing();
}

export async function unsaveLesson(
  lessonId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .delete(lessonSaves)
    .where(
      and(eq(lessonSaves.lessonId, lessonId), eq(lessonSaves.userId, userId)),
    );
}

export interface RecordShareInput {
  lessonId: string;
  userId: string | null;
  channel: ShareChannel;
  /** Only `outbound_link` carries one, and only from the closed list. */
  target?: string | null;
}

/**
 * Records a share.
 *
 * `verified` is derived from the channel HERE, not taken from the caller: a
 * client that could say "this one counts" is a client that can inflate the
 * number, and the whole point of the feature is a count nobody has to take on
 * trust. `outbound_link` is never verified, because no browser can observe
 * whether another origin's Post button was pressed.
 *
 * `on conflict do nothing` against the hourly dedupe index means a reader
 * hammering the button records once an hour and inflates nothing. Anonymous
 * shares fall outside that index — there is no id to deduplicate on — so they
 * are recorded but never counted.
 *
 * Returns nothing, deliberately. Whether this particular request created a row
 * or was deduplicated is not something the caller should branch on: the count
 * the reader sees comes from the trigger either way, and a UI that behaved
 * differently for a deduplicated share would be telling the user about an
 * index.
 */
export async function recordShare(input: RecordShareInput): Promise<void> {
  const verified = input.channel !== "outbound_link";

  await getDb()
    .insert(shareEvents)
    .values({
      lessonId: input.lessonId,
      userId: input.userId,
      channel: input.channel,
      verified: verified && input.userId !== null,
      target: input.target ?? null,
    })
    .onConflictDoNothing();
}

/** The reading list, newest first. Private to its owner — the caller supplies
 * the id from the session, never from the request. */
export async function listSavedLessons(userId: string) {
  return getDb()
    .select({
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      category: lessons.category,
      difficulty: lessons.difficulty,
      savedAt: lessonSaves.createdAt,
    })
    .from(lessonSaves)
    .innerJoin(lessons, eq(lessons.id, lessonSaves.lessonId))
    .where(eq(lessonSaves.userId, userId))
    .orderBy(desc(lessonSaves.createdAt));
}
