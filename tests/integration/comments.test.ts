import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  commentById,
  createComment,
  deleteComment,
  editComment,
  firstReplies,
  listComments,
  listReplies,
  react,
  reportComment,
  setStatus,
} from "@/db/queries/comments";

/**
 * Comments, against real Postgres.
 *
 * Everything here is a claim about the DATABASE rather than about code: the
 * depth cap is a CHECK constraint, the counters are triggers, the reaction
 * switch is an upsert on a composite key, and the keyset pagination is only
 * correct if the index ordering is. A mock would confirm the mock.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const AUTHOR = `c-author-${uuidv7()}`;
const READER = `c-reader-${uuidv7()}`;
const OTHER = `c-other-${uuidv7()}`;
const USERS = [AUTHOR, READER, OTHER];

let lessonId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: `User ${id.slice(-4)}`,
        email: `${id}@comments.invalid`,
      })
      .onConflictDoNothing();
  }

  const [lesson] = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .limit(1);
  expect(lesson, "the seed produced no lessons").toBeTruthy();
  lessonId = lesson!.id;
});

afterAll(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
  for (const id of USERS) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

beforeEach(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
});

const post = (body: string, authorId = AUTHOR, parentId?: string) =>
  createComment(db, {
    subjectType: "lesson",
    subjectId: lessonId,
    authorId,
    body,
    parentId,
  });

describe("threading", () => {
  it("flattens a reply to a reply onto the root", () => {
    // Not depth 2. The cap is what makes the read two flat keyset queries
    // instead of a recursive one that cannot be paginated at all.
    return (async () => {
      const root = await post("root");
      const reply = await post("reply", READER, root.id);
      const nested = await post("reply to the reply", OTHER, reply.id);

      expect(reply.depth).toBe(1);
      expect(nested.depth).toBe(1);
      expect(nested.parentId).toBe(root.id);
    })();
  });

  it("refuses a hand-inserted depth-2 row", async () => {
    // The cap is a CHECK constraint, not a convention: application code that
    // forgets it would produce a row the reader never sees, because the query
    // joins two levels. A comment that silently vanishes is worse than an
    // error at the insert that caused it.
    const root = await post("root");

    await expect(
      db.insert(schema.comments).values({
        id: uuidv7(),
        subjectType: "lesson",
        subjectId: lessonId,
        authorId: AUTHOR,
        body: "too deep",
        depth: 2,
        parentId: root.id,
        rootId: root.id,
        path: `${root.id}/x`,
      }),
    ).rejects.toThrow();
  });

  it("refuses a reply that names no parent", async () => {
    // Malformed threading reads as a top-level comment on the feed, which is
    // how a reply ends up looking like a non-sequitur at the top of a page.
    await expect(
      db.insert(schema.comments).values({
        id: uuidv7(),
        subjectType: "lesson",
        subjectId: lessonId,
        authorId: AUTHOR,
        body: "orphan",
        depth: 1,
        path: "x",
      }),
    ).rejects.toThrow();
  });

  it("refuses a reply grafted onto another subject", async () => {
    const root = await post("root");
    await expect(
      createComment(db, {
        subjectType: "lesson",
        subjectId: uuidv7(),
        authorId: READER,
        body: "grafted",
        parentId: root.id,
      }),
    ).rejects.toThrow(/different subject/);
  });
});

describe("keyset pagination", () => {
  it("neither duplicates nor skips when a comment arrives mid-scroll", async () => {
    // The bug offset has: a row inserted at the top shifts everything down, so
    // the reader sees a duplicate at every page boundary. A cursor names a row.
    for (let i = 0; i < 6; i++) await post(`comment ${i}`);

    const first = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
      limit: 3,
    });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    // Somebody comments while the reader is between pages.
    await post("brand new", OTHER);

    const second = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
      limit: 3,
      cursor: first.nextCursor,
    });

    const seen = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
    // And nothing between the two pages was skipped.
    expect(second.items.map((r) => r.body)).toEqual([
      "comment 2",
      "comment 1",
      "comment 0",
    ]);
  });

  it("walks the whole thread exactly once", async () => {
    for (let i = 0; i < 11; i++) await post(`c${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const page: Awaited<ReturnType<typeof listComments>> = await listComments(
        db,
        { subjectType: "lesson", subjectId: lessonId, limit: 4, cursor },
      );
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(11);
    expect(new Set(seen).size).toBe(11);
  });

  it("refuses to trust a tampered cursor rather than scanning", async () => {
    await post("one");
    // Garbage decodes to null, which means "first page" — not an error, and
    // not an unbounded scan.
    const page = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
      cursor: "not-a-cursor",
    });
    expect(page.items).toHaveLength(1);
  });
});

describe("reactions", () => {
  it("switches sides in one row, moving both counters", async () => {
    const root = await post("react to me");

    await react(db, root.id, READER, "like");
    await react(db, root.id, READER, "dislike");

    const rows = await db
      .select()
      .from(schema.commentReactions)
      .where(eq(schema.commentReactions.commentId, root.id));
    expect(rows).toHaveLength(1);

    const [after] = await db
      .select({
        like: schema.comments.likeCount,
        dislike: schema.comments.dislikeCount,
      })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));

    expect(after).toEqual({ like: 0, dislike: 1 });
  });

  it("is idempotent under a double submit", async () => {
    const root = await post("react to me");
    await Promise.all([
      react(db, root.id, READER, "like"),
      react(db, root.id, READER, "like"),
    ]);

    const [after] = await db
      .select({ like: schema.comments.likeCount })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));
    expect(after!.like).toBe(1);
  });

  it("counts match COUNT(*) after a mixed sequence", async () => {
    const root = await post("counter check");

    await react(db, root.id, READER, "like");
    await react(db, root.id, OTHER, "like");
    await react(db, root.id, OTHER, "dislike");
    await react(db, root.id, AUTHOR, "like");
    await react(db, root.id, READER, null);

    const [counted] = await db
      .select({
        likes: sql<number>`count(*) filter (where type = 'like')::int`,
        dislikes: sql<number>`count(*) filter (where type = 'dislike')::int`,
      })
      .from(schema.commentReactions)
      .where(eq(schema.commentReactions.commentId, root.id));

    const [stored] = await db
      .select({
        like: schema.comments.likeCount,
        dislike: schema.comments.dislikeCount,
      })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));

    expect(stored!.like).toBe(counted!.likes);
    expect(stored!.dislike).toBe(counted!.dislikes);
  });

  it("decrements when a reacting account is deleted", async () => {
    // `on delete cascade` removes the reaction without running any application
    // code at all. Nothing in a service layer can decrement what it never
    // sees; the trigger fires anyway.
    const doomed = `c-doomed-${uuidv7()}`;
    await db.insert(schema.users).values({
      id: doomed,
      name: "Doomed",
      email: `${doomed}@comments.invalid`,
    });

    const root = await post("outlives its liker");
    await react(db, root.id, doomed, "like");
    await db.delete(schema.users).where(eq(schema.users.id, doomed));

    const [after] = await db
      .select({ like: schema.comments.likeCount })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));
    expect(after!.like).toBe(0);
  });

  it("shows the viewer their own reaction and nobody else's", async () => {
    // Who liked what is not public.
    const root = await post("whose like is it");
    await react(db, root.id, OTHER, "like");

    const asReader = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
      viewerId: READER,
    });
    expect(asReader.items[0]!.viewerReaction).toBeNull();
    expect(asReader.items[0]!.likeCount).toBe(1);

    const asOther = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
      viewerId: OTHER,
    });
    expect(asOther.items[0]!.viewerReaction).toBe("like");
  });
});

describe("deleting", () => {
  it("leaves a tombstone when there are replies", async () => {
    // Hard-deleting orphans the conversation: the answers remain and the
    // question vanishes, so people look like they are talking to themselves.
    const root = await post("the question");
    await post("the answer", READER, root.id);

    expect(await deleteComment(db, root.id, AUTHOR)).toBe("tombstoned");

    const page = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
    });
    expect(page.items).toHaveLength(1);
    // Gone from the RESPONSE, not merely hidden in the client.
    expect(page.items[0]!.body).toBe("");
    expect(page.items[0]!.authorId).toBeNull();
    expect(page.items[0]!.authorName).toBeNull();
    expect(page.items[0]!.deletedAt).not.toBeNull();

    const replies = await listReplies(db, root.id);
    expect(replies.items).toHaveLength(1);
    expect(replies.items[0]!.body).toBe("the answer");
  });

  it("removes the row when there are none", async () => {
    const root = await post("nobody replied");
    expect(await deleteComment(db, root.id, AUTHOR)).toBe("removed");
    expect(await commentById(db, root.id)).toBeNull();
  });

  it("clears the body from the row, not just from the reply", async () => {
    const root = await post("secret");
    await post("reply", READER, root.id);
    await deleteComment(db, root.id, AUTHOR);

    const [raw] = await db
      .select({ body: schema.comments.body })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));
    expect(raw!.body).toBe("");
  });
});

describe("editing", () => {
  it("marks the row rather than rewriting history silently", async () => {
    const root = await post("frist");
    expect(await editComment(db, root.id, AUTHOR, "first")).toBe(true);

    const page = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
    });
    expect(page.items[0]!.body).toBe("first");
    expect(page.items[0]!.editedAt).not.toBeNull();
  });

  it("cannot be done by somebody else", async () => {
    // Scoped in the WHERE clause, so an ownership check is not something a
    // route can forget to write.
    const root = await post("mine");
    expect(await editComment(db, root.id, READER, "yours")).toBe(false);
  });

  it("cannot resurrect a tombstone", async () => {
    const root = await post("the question");
    await post("the answer", READER, root.id);
    await deleteComment(db, root.id, AUTHOR);

    expect(await editComment(db, root.id, AUTHOR, "back again")).toBe(false);
  });
});

describe("moderation", () => {
  it("keeps hidden and removed out of the response entirely", async () => {
    // At the SQL layer. A comment filtered in JavaScript is a comment that is
    // in the network response, and "removed" that anybody can read in devtools
    // is not removed.
    const visible = await post("fine");
    const hidden = await post("hide me");
    await setStatus(db, hidden.id, "hidden");

    const page = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
    });
    expect(page.items.map((row) => row.id)).toEqual([visible.id]);
  });

  it("leaves a flagged comment readable", async () => {
    // `flagged` is a queue marker, not a punishment: auto-hiding on a
    // heuristic hands anybody with four links a censor's button.
    const flagged = await post("lots of links");
    await setStatus(db, flagged.id, "flagged");

    const page = await listComments(db, {
      subjectType: "lesson",
      subjectId: lessonId,
    });
    expect(page.items).toHaveLength(1);
  });

  it("takes one report per person, however many times they press it", async () => {
    const root = await post("report me");
    await reportComment(db, root.id, READER, "spam");
    await reportComment(db, root.id, READER, "spam again");

    const rows = await db
      .select()
      .from(schema.commentReports)
      .where(eq(schema.commentReports.commentId, root.id));
    expect(rows).toHaveLength(1);
    // The first reason stands: a second press is not new information.
    expect(rows[0]!.reason).toBe("spam");
  });
});

describe("counters", () => {
  it("keeps the lesson's comment count in step, including moderation", async () => {
    const [before] = await db
      .select({ count: schema.lessons.commentCount })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId));

    const a = await post("one");
    const b = await post("two");
    await post("three", READER, a.id);

    const [afterInserts] = await db
      .select({ count: schema.lessons.commentCount })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId));
    expect(afterInserts!.count).toBe(before!.count + 3);

    // Hiding one moves the number the page shows: a count that included
    // hidden rows would advertise comments nobody can read.
    await setStatus(db, b.id, "hidden");
    const [afterHide] = await db
      .select({ count: schema.lessons.commentCount })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId));
    expect(afterHide!.count).toBe(before!.count + 2);

    // And restoring it puts the number back.
    await setStatus(db, b.id, "visible");
    const [afterRestore] = await db
      .select({ count: schema.lessons.commentCount })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId));
    expect(afterRestore!.count).toBe(before!.count + 3);
  });

  it("counts replies on the root, and drops a tombstone from the total", async () => {
    const root = await post("root");
    const reply = await post("reply", READER, root.id);

    const [withReply] = await db
      .select({ replies: schema.comments.replyCount })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));
    expect(withReply!.replies).toBe(1);

    await deleteComment(db, reply.id, READER);
    const [after] = await db
      .select({ replies: schema.comments.replyCount })
      .from(schema.comments)
      .where(eq(schema.comments.id, root.id));
    expect(after!.replies).toBe(0);
  });
});

describe("loading a page of threads", () => {
  it("fetches every root's replies in one query", async () => {
    // N+1 here is twenty round trips to render one screen, and it grows with
    // the page size.
    const roots = [];
    for (let i = 0; i < 3; i++) roots.push(await post(`root ${i}`));
    for (const root of roots) {
      await post(`reply a to ${root.id}`, READER, root.id);
      await post(`reply b to ${root.id}`, OTHER, root.id);
    }

    const grouped = await firstReplies(
      db,
      roots.map((r) => r.id),
      1,
    );

    expect(grouped.size).toBe(3);
    for (const root of roots) {
      // Capped at one each, with `replyCount` telling the UI there is more.
      expect(grouped.get(root.id)).toHaveLength(1);
    }
  });
});
