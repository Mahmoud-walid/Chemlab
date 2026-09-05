"use server";

import { getTranslations } from "next-intl/server";

import { getUserTimeline } from "@/db/queries/admin/users";
import { requirePermission } from "@/lib/authz";

export interface TimelineItem {
  id: string;
  /**
   * Already translated. Resolved on the SERVER, where the rest of the admin
   * resolves it — `admin.activity.verbs` holds FLAT keys containing dots
   * ("exam.submitted"), and addressing one from a client namespace scoped to
   * `admin.activity.verbs` makes next-intl read the dot as nesting and render
   * the raw key. Doing it here means one mechanism rather than two that have
   * to agree.
   */
  label: string;
  objectType: string | null;
  objectId: string | null;
  at: string;
}

export interface TimelinePageResult {
  entries: TimelineItem[];
  nextCursor: string | null;
}

/**
 * The next page of somebody's timeline.
 *
 * Re-checks `activity:read` on every call. The page that rendered the first
 * page checked too, but a server action is its own entry point — a caller can
 * invoke it directly, and "the page already checked" protects nothing then.
 */
export async function loadMoreTimeline(input: {
  userId: string;
  cursor: string;
}): Promise<TimelinePageResult> {
  await requirePermission("activity:read");

  const t = await getTranslations("admin.activity");
  const page = await getUserTimeline(input.userId, {
    limit: 25,
    cursor: input.cursor,
  });

  return {
    entries: page.entries.map((entry) => ({
      id: entry.id,
      label: t(`verbs.${entry.verb}` as never),
      objectType: entry.objectType,
      objectId: entry.objectId,
      at: entry.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
