import { z } from "zod";

import { getDb } from "@/db/client";
import {
  createComment,
  firstReplies,
  listComments,
  recentByAuthor,
} from "@/db/queries/comments";
import { checkBody } from "@/lib/comments/body";
import { pageSize } from "@/lib/comments/cursor";
import { decidePost, retryAfterSeconds } from "@/lib/comments/rate-limit";
import { getCurrentUser, requireUserOr401 } from "@/lib/session";

/**
 * The comment feed, and posting to it.
 *
 * **Reading is public, writing needs a session.** The lessons are public, and
 * a discussion nobody can read until they have an account is a discussion that
 * never starts. Recorded as Q38b in docs/DEFERRED_QUESTIONS.md.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How many replies ride along with each root. Enough to show a thread is a
 * thread; `replyCount` tells the UI how many more there are. */
const REPLIES_PER_ROOT = 3;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subjectId");
  const subjectType = url.searchParams.get("subjectType") ?? "lesson";

  if (!subjectId || subjectType !== "lesson") {
    return Response.json({ error: "unknown subject" }, { status: 400 });
  }

  const sort = url.searchParams.get("sort") === "top" ? "top" : "new";
  const cursorParam = url.searchParams.get("cursor");

  // A cursor we did not issue is a 400, never a 500 and never an unbounded
  // scan — it goes straight into a WHERE clause.
  if (cursorParam !== null && cursorParam.length > 512) {
    return Response.json({ error: "bad cursor" }, { status: 400 });
  }

  // Optional: an anonymous reader gets the same comments with no reaction
  // state of their own.
  const viewer = await getCurrentUser();
  const db = getDb();

  const page = await listComments(db, {
    subjectType: "lesson",
    subjectId,
    sort,
    cursor: cursorParam,
    limit: pageSize(url.searchParams.get("limit")),
    viewerId: viewer?.id ?? null,
  });

  const replies = await firstReplies(
    db,
    page.items.map((row) => row.id),
    REPLIES_PER_ROOT,
    viewer?.id ?? null,
  );

  return Response.json(
    {
      items: page.items.map((item) => ({
        ...item,
        replies: replies.get(item.id) ?? [],
      })),
      nextCursor: page.nextCursor,
    },
    // Per-viewer (their own reactions) and constantly changing.
    { headers: { "cache-control": "no-store, private" } },
  );
}

const postSchema = z.object({
  subjectType: z.literal("lesson"),
  subjectId: z.uuid(),
  parentId: z.uuid().nullish(),
  body: z.string(),
});

export async function POST(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "invalid comment" },
      { status: 400 },
    );
  }

  const check = checkBody(parsed.data.body);
  if (!check.ok) {
    return Response.json({ error: check.reason }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  // Server-side, and from the person's own rows: a limit the client applies is
  // a suggestion, and one that reads a separate counter table can drift from
  // what was actually posted.
  const decision = decidePost(
    await recentByAuthor(db, user.id, now),
    check.body!,
    now,
  );

  if (!decision.allowed) {
    return Response.json(
      { error: decision.reason },
      {
        status: 429,
        // An honest number, not a guess: the limiter knows exactly when the
        // window reopens.
        headers: { "retry-after": String(retryAfterSeconds(decision)) },
      },
    );
  }

  const created = await createComment(db, {
    subjectType: "lesson",
    subjectId: parsed.data.subjectId,
    authorId: user.id,
    body: check.body!,
    parentId: parsed.data.parentId ?? null,
    flagged: check.flagged,
  });

  return Response.json(created, { status: 201 });
}
