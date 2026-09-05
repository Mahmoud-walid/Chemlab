import { getDb } from "@/db/client";
import { preferencesFor, savePreferences } from "@/db/queries/notifications";
import {
  preferencesPatchSchema,
  toUpdate,
} from "@/lib/notifications/preferences-input";
import { requireUserOr401 } from "@/lib/session";

/**
 * A person's own notification preferences.
 *
 * As with the inbox, there is no user id parameter: the owner comes from the
 * session, so editing somebody else's preferences is not something the API can
 * express.
 *
 * `PATCH`, not `PUT`. A settings page that sent the whole object would
 * overwrite a field it was rendered before it changed — two tabs open, and the
 * later save silently undoes the earlier one's unrelated switch.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  return Response.json(await preferencesFor(getDb(), user.id), {
    headers: { "cache-control": "no-store, private" },
  });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = preferencesPatchSchema.safeParse(body);

  if (!parsed.success) {
    // The message, not the whole Zod tree: the tree names internal field
    // paths, and the client cannot act on any of it beyond "that was refused".
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "invalid preferences" },
      { status: 400 },
    );
  }

  const db = getDb();
  const current = await preferencesFor(db, user.id);
  const saved = await savePreferences(
    db,
    user.id,
    toUpdate(parsed.data, current),
  );

  return Response.json(saved, {
    headers: { "cache-control": "no-store, private" },
  });
}
