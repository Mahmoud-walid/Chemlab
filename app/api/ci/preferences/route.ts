import { getDb } from "@/db/client";
import { ciPreferencesFor, saveCiPreferences } from "@/db/queries/ci";
import { ciPreferencesPatchSchema, toUpdate } from "@/lib/ci/preferences-input";
import { can } from "@/lib/authz";
import { requireUserOr401 } from "@/lib/session";

/**
 * A developer's own CI alert settings.
 *
 * No user id parameter: the owner comes from the session, so subscribing
 * somebody else to build noise is not something the API can express.
 *
 * Gated on `notification:subscribe_ci` rather than on a role. Deriving it from
 * `admin:access` would contradict what `ci_notification_preferences` says out
 * loud — holding admin is not a request to be woken by a build — and leaving
 * it ungated would put branch names, commit messages and failure detail on the
 * settings page of a site aimed at children. No role holds the permission by
 * default; a Super Admin grants it to whoever works on this project.
 *
 * `PATCH`, not `PUT`, for the same reason as the notification preferences it
 * sits beside: a form that sent the whole object would overwrite a field it
 * was rendered before it changed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 404, not 403. Somebody without the permission has no business learning
 * that this repository notifies anybody about its builds. */
const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET() {
  const { user, response } = await requireUserOr401();
  if (response) return response;
  if (!(await can("notification:subscribe_ci"))) return notFound();

  return Response.json(await ciPreferencesFor(getDb(), user.id), {
    headers: { "cache-control": "no-store, private" },
  });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUserOr401();
  if (response) return response;
  if (!(await can("notification:subscribe_ci"))) return notFound();

  const body = await request.json().catch(() => null);
  const parsed = ciPreferencesPatchSchema.safeParse(body);

  if (!parsed.success) {
    // The message, not the whole Zod tree: the tree names internal field
    // paths, and the client cannot act on any of it beyond "that was refused".
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "invalid preferences" },
      { status: 400 },
    );
  }

  const saved = await saveCiPreferences(
    getDb(),
    user.id,
    toUpdate(parsed.data),
  );

  return Response.json(saved, {
    headers: { "cache-control": "no-store, private" },
  });
}
