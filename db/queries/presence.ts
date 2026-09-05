import { eq, lt, sql } from "drizzle-orm";

import type { AnyDatabase } from "@/db/any-database";
import { userPresence } from "@/db/schema/presence";
import { WRITE_FLOOR_SECONDS } from "@/lib/presence/constants";
import type { PresenceState } from "@/lib/presence/state";

/**
 * Reading and writing presence.
 *
 * The visibility rule is applied in the VIEW, not here and not in the client:
 * somebody who hid their presence must be offline in the response bytes, or
 * "hidden" means "hidden unless you open devtools".
 */

export interface PresenceRow {
  userId: string;
  state: PresenceState;
  lastSeenAt: Date | null;
  /** Admin-only. A coarse route pattern, never a URL with a query string. */
  lastPath: string | null;
}

/**
 * Records a beat, at most once per write floor.
 *
 * The condition is what caps the write load: a duplicate beat, a retry, or a
 * second tab that lost the election matches ZERO rows and costs nothing. It is
 * an upsert because the first beat of a user's life has no row to update.
 */
export async function heartbeat(
  db: AnyDatabase,
  userId: string,
  lastPath: string | null = null,
): Promise<{ written: boolean }> {
  const changed = await db
    .insert(userPresence)
    .values({ userId, lastSeenAt: new Date(), lastPath })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: { lastSeenAt: new Date(), lastPath },
      // The floor. Without it, five tabs and a flaky network multiply the
      // write rate by however many beats arrive.
      where: lt(
        userPresence.lastSeenAt,
        sql`now() - interval '${sql.raw(String(WRITE_FLOOR_SECONDS))} seconds'`,
      ),
    })
    .returning();

  return { written: changed.length > 0 };
}

/**
 * Presence for a batch of people.
 *
 * Batched because a page of forty comment avatars must issue one request, not
 * forty — and because the alternative is a query per avatar against a table
 * every online user is writing to.
 *
 * `includePath` is the admin's extra: everybody else gets state and a
 * timestamp, and a reader who is hidden gets neither.
 */
export async function presenceFor(
  db: AnyDatabase,
  userIds: readonly string[],
  options: { includePath?: boolean } = {},
): Promise<PresenceRow[]> {
  if (userIds.length === 0) return [];

  const rows = await db.execute<{
    user_id: string;
    state: PresenceState;
    last_seen_at: Date | null;
    last_path: string | null;
  }>(sql`
    select user_id, state, last_seen_at, last_path
    from presence_state
    where user_id in (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);

  const list =
    (rows as unknown as { rows?: PresenceRow[] }).rows ??
    (rows as unknown as PresenceRow[]);

  return (list as unknown as Record<string, unknown>[]).map((row) => ({
    userId: String(row.user_id ?? row.userId),
    state: (row.state ?? "offline") as PresenceState,
    lastSeenAt: (row.last_seen_at ?? row.lastSeenAt ?? null) as Date | null,
    // Withheld unless the caller is entitled to it. Done here rather than in
    // the route so a second caller cannot forget.
    lastPath: options.includePath
      ? ((row.last_path ?? row.lastPath ?? null) as string | null)
      : null,
  }));
}

/** Clears somebody's presence outright — for the moment they choose to hide.
 * The view would already report them offline; this stops the row existing at
 * all, so there is nothing to leak later. */
export async function forgetPresence(
  db: AnyDatabase,
  userId: string,
): Promise<void> {
  await db.delete(userPresence).where(eq(userPresence.userId, userId));
}

/** The admin list's page: who has been seen, most recent first. */
export async function recentlySeen(db: AnyDatabase, limit = 50) {
  return db.execute(sql`
    select user_id, state, last_seen_at, last_path
    from presence_state
    order by last_seen_at desc nulls last
    limit ${limit}
  `);
}
