import { z } from "zod";

import { getDb } from "@/db/client";
import { commentById, deleteComment, editComment } from "@/db/queries/comments";
import { checkBody } from "@/lib/comments/body";
import { requireUserOr401 } from "@/lib/session";
import { can } from "@/lib/authz";

/**
 * Editing and deleting one comment.
 *
 * Both answer **404 for a comment that is not yours**, not 403. A 403 confirms
 * the id exists and that somebody else wrote it, which is a small oracle for
 * enumerating a thread's authorship — and there is nothing a stranger can do
 * with the distinction anyway.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const { id } = await params;
  const parsed = z
    .object({ body: z.string() })
    .safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const check = checkBody(parsed.data.body);
  if (!check.ok) return Response.json({ error: check.reason }, { status: 400 });

  const db = getDb();
  // The update is scoped to the author in its own WHERE clause, so this is
  // belt and braces rather than the only check.
  const edited = await editComment(db, id, user.id, check.body!);

  return edited ? Response.json({ ok: true }) : notFound();
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const { id } = await params;
  const db = getDb();
  const comment = await commentById(db, id);

  if (!comment || comment.deletedAt !== null) return notFound();

  const isAuthor = comment.authorId === user.id;
  // A moderator may delete anybody's; the row records who did it either way.
  const canModerate = isAuthor || (await can("comment:moderate"));
  if (!canModerate) return notFound();

  const outcome = await deleteComment(db, id, user.id);
  if (outcome === "missing") return notFound();

  return Response.json({ outcome });
}
