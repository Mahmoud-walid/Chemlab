import { getDb } from "@/db/client";
import { listNotifications, unreadCount } from "@/db/queries/notifications";
import { requireUserOr401 } from "@/lib/session";

/**
 * `GET /api/notifications` — this person's inbox, newest first.
 *
 * There is no user id parameter, and that is the security design rather than
 * an omission: the recipient comes from the session, so requesting somebody
 * else's notifications is not something the API can express. An endpoint that
 * took an id would need a check that could be forgotten.
 *
 * Cursor-paginated on the row id. The ids are UUID v7, so ordering by id is
 * ordering by time — and unlike a timestamp it is unique, so a page boundary
 * cannot fall between two rows sharing a millisecond.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const before = url.searchParams.get("before") ?? undefined;

  const db = getDb();
  const [page, unread] = await Promise.all([
    listNotifications(db, user.id, {
      limit: Number.isFinite(limit) ? limit : 20,
      before,
    }),
    unreadCount(db, user.id),
  ]);

  return Response.json(
    { ...page, unread },
    // The answer depends on who is asking, and changes constantly.
    { headers: { "cache-control": "no-store, private" } },
  );
}
