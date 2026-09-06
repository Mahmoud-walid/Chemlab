import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { forgetPresence } from "@/db/queries/presence";
import { users } from "@/db/schema/auth";
import { requireUserOr401 } from "@/lib/session";

/**
 * Whether other people can see when this person is online.
 *
 * Choosing `nobody` also FORGETS the existing row rather than merely hiding
 * it. The view would already report them offline, but a stored timestamp is a
 * stored timestamp: somebody who says "stop showing this" should not have to
 * trust that every future query remembers to filter.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ visibility: z.enum(["everyone", "nobody"]) });

export async function GET() {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const [row] = await getDb()
    .select({ visibility: users.presenceVisibility })
    .from(users)
    .where(eq(users.id, user.id));

  return Response.json(
    // `nobody` when the row is somehow missing, matching the column default
    // (Q39). A fallback that disagreed with the default would report a
    // signed-in reader as visible when the database says otherwise — and it
    // is the wrong direction to be wrong in, since the switch it feeds would
    // then show "on" for somebody who never turned it on.
    { visibility: row?.visibility ?? "nobody" },
    { headers: { "cache-control": "no-store, private" } },
  );
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "everyone or nobody" }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(users)
    .set({ presenceVisibility: parsed.data.visibility })
    .where(eq(users.id, user.id));

  if (parsed.data.visibility === "nobody") {
    await forgetPresence(db, user.id);
  }

  return Response.json({ visibility: parsed.data.visibility });
}
