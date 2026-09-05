"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { invalidatePageCache } from "@/db/queries/pages";
import { pages } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";
import { isAlwaysOpen } from "@/lib/pages/routes";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";

export interface PageToggleResult {
  ok: boolean;
  problem?: string;
}

/**
 * Everything a write to `pages` has to do besides the write itself.
 *
 * The cache invalidation is the part that is easy to forget and hard to notice:
 * without it a closed page stays reachable for the TTL, and the operator's
 * first move is to click the switch again.
 */
function afterWrite(routeKey: string) {
  invalidatePageCache();
  revalidatePath("/admin/pages");
  // The nav bar and the sitemap are rendered from this state, so every public
  // route has to be revalidated, not only the one that changed.
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  if (routeKey !== "/") revalidatePath(routeKey);
}

/**
 * Opens or closes one route.
 *
 * `isAlwaysOpen` is re-checked here, not just kept out of the UI. The route key
 * arrives from the client, and a caller who posts `/admin` should be refused by
 * the server rather than by the absence of a button — that is the difference
 * between a rule and a convention.
 */
export async function setPageEnabled(
  routeKey: string,
  isEnabled: boolean,
): Promise<PageToggleResult> {
  const actor = await requirePermission("page:toggle");

  if (isAlwaysOpen(routeKey)) {
    return {
      ok: false,
      problem:
        "That route has no switch: closing it would close the page that reopens it.",
    };
  }

  const db = getDb();
  const [before] = await db
    .select()
    .from(pages)
    .where(eq(pages.routeKey, routeKey))
    .limit(1);

  if (!before) return { ok: false, problem: "That page has no switch." };

  await db.transaction(async (tx) => {
    await tx
      .update(pages)
      .set({
        isEnabled,
        // Kept as the record of when it was last closed and by whom. Cleared
        // on reopen, so "closed since" never describes a page that is open.
        disabledAt: isEnabled ? null : new Date(),
        disabledBy: isEnabled ? null : actor.userId,
      })
      .where(eq(pages.routeKey, routeKey));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: isEnabled ? "page.open" : "page.close",
      targetType: "page",
      targetId: routeKey,
      before: { isEnabled: before.isEnabled },
      after: { isEnabled },
    });
  });

  await recordActivity({
    verb: "admin.page_toggled",
    objectType: "page",
    objectId: routeKey,
    metadata: { isEnabled },
  });

  afterWrite(routeKey);
  return { ok: true };
}

/** Shows or hides an open route in the public navigation. */
export async function setPageInNav(
  routeKey: string,
  showInNav: boolean,
): Promise<PageToggleResult> {
  const actor = await requirePermission("page:toggle");

  const db = getDb();
  const [before] = await db
    .select()
    .from(pages)
    .where(eq(pages.routeKey, routeKey))
    .limit(1);

  if (!before) return { ok: false, problem: "That page has no switch." };

  await db.transaction(async (tx) => {
    await tx
      .update(pages)
      .set({ showInNav })
      .where(eq(pages.routeKey, routeKey));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "page.nav",
      targetType: "page",
      targetId: routeKey,
      before: { showInNav: before.showInNav },
      after: { showInNav },
    });
  });

  await recordActivity({
    verb: "admin.page_toggled",
    objectType: "page",
    objectId: routeKey,
    metadata: { showInNav },
  });

  afterWrite(routeKey);
  return { ok: true };
}

/**
 * Sets the message shown instead of a closed page.
 *
 * Both locales at once: a message written in one language only would leave
 * half the audience reading the generic default with no sign that anything
 * more specific was said.
 */
export async function setMaintenanceMessage(
  routeKey: string,
  message: { en: string; ar: string },
): Promise<PageToggleResult> {
  const actor = await requirePermission("page:toggle");

  const db = getDb();
  const [before] = await db
    .select()
    .from(pages)
    .where(eq(pages.routeKey, routeKey))
    .limit(1);

  if (!before) return { ok: false, problem: "That page has no switch." };

  const en = message.en.trim().slice(0, 500);
  const ar = message.ar.trim().slice(0, 500);
  // Both blank means "use the default wording", which is null rather than a
  // pair of empty strings — otherwise the maintenance page would render an
  // empty paragraph instead of falling back.
  const value = en === "" && ar === "" ? null : { en, ar };

  await db.transaction(async (tx) => {
    await tx
      .update(pages)
      .set({ maintenanceMessage: value })
      .where(eq(pages.routeKey, routeKey));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "page.message",
      targetType: "page",
      targetId: routeKey,
      before: { maintenanceMessage: before.maintenanceMessage },
      after: { maintenanceMessage: value },
    });
  });

  await recordActivity({
    verb: "admin.updated",
    objectType: "page",
    objectId: routeKey,
    // The message text itself is not recorded: it is operator prose, it can be
    // long, and the audit entry already holds the before/after.
    metadata: { maintenanceMessage: value === null ? "cleared" : "set" },
  });

  afterWrite(routeKey);
  return { ok: true };
}
