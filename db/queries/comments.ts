import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import type { AnyDatabase } from "@/db/any-database";
import {
  comments,
  commentReactions,
  commentReports,
} from "@/db/schema/comments";
import { users } from "@/db/schema/auth";
import { decodeCursor, encodeCursor, type Cursor } from "@/lib/comments/cursor";
import { HOUR_MS } from "@/lib/comments/rate-limit";

/**
 * Reading and writing comments.
 *
 * Two rules run through all of it:
 *
 * - **Moderation is applied in SQL, never in the client.** A hidden comment
 *   that is filtered in JavaScript is a hidden comment that is in the network
 *   response, and "removed" that anyone can read in devtools is not removed.
 * - **Keyset, never `OFFSET`.** See lib/comments/cursor.ts for why offset is
 *   not merely slow but wrong under concurrent writes.
 */

/** What a reader may see. `flagged` is included: it is a queue marker for a
 * moderator, not a punishment, and hiding on a heuristic hands anybody with
 * four links a censor's button. */
const READABLE = sql`${comments.status} in ('visible', 'flagged')`;

export type CommentSort = "new" | "top";

export interface CommentRow {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  status: "visible" | "hidden" | "flagged" | "removed";
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  /** The caller's own reaction, when there is a caller. Never another
   * person's: who liked what is not public. */
  viewerReaction: "like" | "dislike" | null;
}

export interface CommentPage {
  items: CommentRow[];
  nextCursor: string | null;
}

const AUTHOR_FIELDS = {
  authorName: users.name,
  authorImage: users.image,
};

/**
 * A tombstone tells the reader something was here and is gone; it must not
 * tell them what it said or who said it.
 *
 * Applied in the SELECT rather than after it, so the body of a deleted comment
 * never leaves the database. Filtering it in the route would put it in the
 * response of anybody who looked at the network tab.
 */
const BODY = sql<string>`case when ${comments.deletedAt} is null then ${comments.body} else '' end`;
const AUTHOR_ID = sql<
  string | null
>`case when ${comments.deletedAt} is null then ${comments.authorId} else null end`;

function selection(viewerId: string | null) {
  return {
    id: comments.id,
    parentId: comments.parentId,
    depth: comments.depth,
    body: BODY,
    status: comments.status,
    authorId: AUTHOR_ID,
    authorName: sql<
      string | null
    >`case when ${comments.deletedAt} is null then ${users.name} else null end`,
    authorImage: sql<
      string | null
    >`case when ${comments.deletedAt} is null then ${users.image} else null end`,
    likeCount: comments.likeCount,
    dislikeCount: comments.dislikeCount,
    replyCount: comments.replyCount,
    editedAt: comments.editedAt,
    deletedAt: comments.deletedAt,
    createdAt: comments.createdAt,
    viewerReaction: viewerId
      ? sql<"like" | "dislike" | null>`(
          select r.type from comment_reactions r
          where r.comment_id = ${comments.id} and r.user_id = ${viewerId}
        )`
      : sql<"like" | "dislike" | null>`null::reaction_type`,
  };
}

/** Top-level comments for a subject, newest first or by score. */
export async function listComments(
  db: AnyDatabase,
  options: {
    subjectType: "lesson";
    subjectId: string;
    sort?: CommentSort;
    cursor?: string | null;
    limit?: number;
    viewerId?: string | null;
  },
): Promise<CommentPage> {
  const { subjectType, subjectId, viewerId = null } = options;
  const sort = options.sort ?? "new";
  const limit = options.limit ?? 20;
  const cursor = decodeCursor(options.cursor);

  const score = sql<number>`(${comments.likeCount} - ${comments.dislikeCount})`;

  const base = and(
    eq(comments.subjectType, subjectType),
    eq(comments.subjectId, subjectId),
    eq(comments.depth, 0),
    READABLE,
  );

  // The cursor names a ROW, so nothing shifts under it when a comment is
  // inserted or deleted between two pages.
  const after =
    cursor === null
      ? undefined
      : cursor.kind === "time"
        ? or(
            lt(comments.createdAt, new Date(cursor.createdAt)),
            and(
              eq(comments.createdAt, new Date(cursor.createdAt)),
              lt(comments.id, cursor.id),
            ),
          )
        : or(
            sql`${score} < ${cursor.score}`,
            and(sql`${score} = ${cursor.score}`, lt(comments.id, cursor.id)),
          );

  const rows = await db
    .select(selection(viewerId))
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(after ? and(base, after) : base)
    .orderBy(
      ...(sort === "top"
        ? [desc(score), desc(comments.id)]
        : [desc(comments.createdAt), desc(comments.id)]),
    )
    // One more than asked for: the extra row is how we know there IS a next
    // page, without a second COUNT query over the whole thread.
    .limit(limit + 1);

  const items = rows.slice(0, limit) as CommentRow[];
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(
            sort === "top"
              ? {
                  kind: "score",
                  score: last.likeCount - last.dislikeCount,
                  id: last.id,
                }
              : {
                  kind: "time",
                  createdAt: last.createdAt.toISOString(),
                  id: last.id,
                },
          )
        : null,
  };
}

/**
 * The first replies for several roots at once.
 *
 * One query for the whole page of roots rather than one per root: N+1 here is
 * twenty round trips to render one screen, and it grows with the page size.
 */
export async function firstReplies(
  db: AnyDatabase,
  rootIds: readonly string[],
  perRoot: number,
  viewerId: string | null = null,
): Promise<Map<string, CommentRow[]>> {
  const grouped = new Map<string, CommentRow[]>();
  if (rootIds.length === 0) return grouped;

  const rows = (await db
    .select(selection(viewerId))
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(and(inArray(comments.parentId, [...rootIds]), READABLE))
    .orderBy(asc(comments.createdAt), asc(comments.id))) as CommentRow[];

  for (const row of rows) {
    const key = row.parentId!;
    const bucket = grouped.get(key) ?? [];
    // Capped here rather than in SQL: a lateral join per root is more machinery
    // than a thread of a few dozen replies is worth, and `replyCount` already
    // tells the UI how many more there are.
    if (bucket.length < perRoot) bucket.push(row);
    grouped.set(key, bucket);
  }

  return grouped;
}

/** A page of one thread's replies, oldest first — the order it happened in. */
export async function listReplies(
  db: AnyDatabase,
  parentId: string,
  options: {
    cursor?: string | null;
    limit?: number;
    viewerId?: string | null;
  } = {},
): Promise<CommentPage> {
  const limit = options.limit ?? 20;
  const viewerId = options.viewerId ?? null;
  const cursor = decodeCursor(options.cursor);

  const base = and(eq(comments.parentId, parentId), READABLE);
  const after =
    cursor === null || cursor.kind !== "time"
      ? undefined
      : or(
          sql`${comments.createdAt} > ${new Date(cursor.createdAt)}`,
          and(
            eq(comments.createdAt, new Date(cursor.createdAt)),
            sql`${comments.id} > ${cursor.id}`,
          ),
        );

  const rows = await db
    .select(selection(viewerId))
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(after ? and(base, after) : base)
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit) as CommentRow[];
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            kind: "time",
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

export interface NewComment {
  subjectType: "lesson";
  subjectId: string;
  authorId: string;
  body: string;
  /** The comment being replied to. May itself be a reply — see below. */
  parentId?: string | null;
  flagged?: boolean;
}

/**
 * Writes a comment, flattening a reply-to-a-reply onto its root.
 *
 * The depth cap is a CHECK constraint, so this cannot quietly produce a
 * depth-2 row: it resolves the parent's own root first and attaches there.
 * The UI adds an @mention of the person being answered, which is what makes
 * the flattening readable rather than confusing.
 */
export async function createComment(
  db: AnyDatabase,
  input: NewComment,
): Promise<{ id: string; depth: number; parentId: string | null }> {
  const id = uuidv7();

  if (!input.parentId) {
    await db.insert(comments).values({
      id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      authorId: input.authorId,
      body: input.body,
      status: input.flagged ? "flagged" : "visible",
      depth: 0,
      path: id,
    });
    return { id, depth: 0, parentId: null };
  }

  const [parent] = await db
    .select({
      id: comments.id,
      depth: comments.depth,
      rootId: comments.rootId,
      subjectId: comments.subjectId,
    })
    .from(comments)
    .where(eq(comments.id, input.parentId));

  if (!parent) throw new Error("no such comment to reply to");
  // A reply must belong to the same subject as its parent, or a thread could
  // be grafted onto another lesson by passing an id from elsewhere.
  if (parent.subjectId !== input.subjectId) {
    throw new Error("parent belongs to a different subject");
  }

  // Replying to a reply attaches to the ROOT, never to the reply.
  const rootId = parent.depth === 0 ? parent.id : parent.rootId!;

  await db.insert(comments).values({
    id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    authorId: input.authorId,
    body: input.body,
    status: input.flagged ? "flagged" : "visible",
    depth: 1,
    parentId: rootId,
    rootId,
    path: `${rootId}/${id}`,
  });

  return { id, depth: 1, parentId: rootId };
}

/** This person's recent comments, for the rate limiter. */
export async function recentByAuthor(
  db: AnyDatabase,
  authorId: string,
  now: Date = new Date(),
): Promise<{ createdAt: Date; body: string }[]> {
  return db
    .select({ createdAt: comments.createdAt, body: comments.body })
    .from(comments)
    .where(
      and(
        eq(comments.authorId, authorId),
        gte(comments.createdAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(desc(comments.createdAt))
    .limit(50);
}

/**
 * Deletes a comment: a tombstone when it has replies, gone when it does not.
 *
 * Hard-deleting a comment with replies orphans a conversation — the answers
 * remain and the question vanishes, which reads as though people are talking
 * to themselves. The tombstone keeps the thread and loses the content.
 */
export async function deleteComment(
  db: AnyDatabase,
  commentId: string,
  by: string,
): Promise<"tombstoned" | "removed" | "missing"> {
  const [row] = await db
    .select({ id: comments.id, replyCount: comments.replyCount })
    .from(comments)
    .where(eq(comments.id, commentId));

  if (!row) return "missing";

  if (row.replyCount > 0) {
    await db
      .update(comments)
      .set({
        deletedAt: new Date(),
        deletedBy: by,
        // Cleared in the same statement that marks it: a body that survives in
        // the row is a body a future query can leak.
        body: "",
        editedAt: null,
      })
      .where(eq(comments.id, commentId));
    return "tombstoned";
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  return "removed";
}

export async function editComment(
  db: AnyDatabase,
  commentId: string,
  authorId: string,
  body: string,
): Promise<boolean> {
  const changed = await db
    .update(comments)
    .set({ body, editedAt: new Date() })
    .where(
      and(
        eq(comments.id, commentId),
        // Scoped to the author in the WHERE: an ownership check in the route
        // is one somebody can forget to write.
        eq(comments.authorId, authorId),
        isNull(comments.deletedAt),
      ),
    )
    .returning();

  return changed.length > 0;
}

/**
 * Sets, switches or clears a reaction.
 *
 * An upsert on the composite key: switching side is an UPDATE of one row, so
 * two clicks arriving together cannot leave two rows or none. The counters are
 * moved by the trigger, in the same transaction.
 */
export async function react(
  db: AnyDatabase,
  commentId: string,
  userId: string,
  type: "like" | "dislike" | null,
): Promise<void> {
  if (type === null) {
    await db
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      );
    return;
  }

  await db
    .insert(commentReactions)
    .values({ commentId, userId, type })
    .onConflictDoUpdate({
      target: [commentReactions.commentId, commentReactions.userId],
      set: { type },
    });
}

/** Reports a comment. Reporting twice is idempotent — twice is not twice as
 * urgent, and without the unique index one angry reader looks like a pile-on. */
export async function reportComment(
  db: AnyDatabase,
  commentId: string,
  reporterId: string,
  reason: string,
  note?: string,
): Promise<void> {
  await db
    .insert(commentReports)
    .values({ commentId, reporterId, reason, note: note ?? null })
    .onConflictDoNothing();
}

/** Moderation. Separate from delete: hiding is reversible and keeps the row
 * for a moderator to look at again. */
export async function setStatus(
  db: AnyDatabase,
  commentId: string,
  status: "visible" | "hidden" | "flagged" | "removed",
): Promise<void> {
  await db.update(comments).set({ status }).where(eq(comments.id, commentId));
}

/** One comment, whatever its status — for the author, and for a moderator. */
export async function commentById(
  db: AnyDatabase,
  commentId: string,
): Promise<{
  id: string;
  authorId: string | null;
  subjectId: string;
  depth: number;
  deletedAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      subjectId: comments.subjectId,
      depth: comments.depth,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(eq(comments.id, commentId));

  return row ?? null;
}

/**
 * The moderation queue: reported comments that nobody has dealt with.
 *
 * Oldest first, because a report that has been waiting three days is more
 * urgent than one from this morning — a newest-first queue is one where the
 * oldest complaint is never reached.
 */
export interface QueuedReport {
  commentId: string;
  body: string;
  status: "visible" | "hidden" | "flagged" | "removed";
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  reportCount: number;
  firstReportedAt: Date;
  reasons: string[];
}

export async function listReportQueue(
  db: AnyDatabase,
  limit = 50,
): Promise<QueuedReport[]> {
  const rows = await db
    .select({
      commentId: comments.id,
      // NOT masked by `deletedAt`, unlike every public read: a moderator
      // deciding whether somebody keeps their account needs to see what was
      // written. That is what `comment:read` buys, and it is why the page is
      // guarded rather than merely unlinked.
      body: comments.body,
      status: comments.status,
      authorId: comments.authorId,
      authorName: users.name,
      createdAt: comments.createdAt,
      reportCount: sql<number>`count(${commentReports.id})::int`,
      firstReportedAt: sql<Date>`min(${commentReports.createdAt})`,
      reasons: sql<string[]>`array_agg(distinct ${commentReports.reason})`,
    })
    .from(commentReports)
    .innerJoin(comments, eq(comments.id, commentReports.commentId))
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(isNull(commentReports.resolvedAt))
    .groupBy(
      comments.id,
      comments.body,
      comments.status,
      comments.authorId,
      users.name,
      comments.createdAt,
    )
    .orderBy(sql`min(${commentReports.createdAt}) asc`)
    .limit(limit);

  return rows as QueuedReport[];
}

/** How many reports are waiting — for a badge on the admin nav. */
export async function openReportCount(db: AnyDatabase): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentReports)
    .where(isNull(commentReports.resolvedAt));
  return row?.count ?? 0;
}

/**
 * Closes every open report on a comment.
 *
 * Resolving is separate from acting: a moderator who decides a comment is fine
 * still needs the report to leave the queue, or the same argument arrives every
 * morning.
 */
export async function resolveReports(
  db: AnyDatabase,
  commentId: string,
  resolvedBy: string,
): Promise<number> {
  const changed = await db
    .update(commentReports)
    .set({ resolvedAt: new Date(), resolvedBy })
    .where(
      and(
        eq(commentReports.commentId, commentId),
        isNull(commentReports.resolvedAt),
      ),
    )
    .returning();

  return changed.length;
}
