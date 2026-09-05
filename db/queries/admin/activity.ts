import "server-only";
import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema/activity";
import { users } from "@/db/schema/auth";
import { isActivityVerb, type ActivityVerb } from "@/lib/activity/verbs";
import { offsetFor, pageCount, type ListParams } from "./list-params";

/**
 * The activity stream, for the admin screen.
 *
 * Sorting is fixed to newest-first and is not a URL parameter. Every other
 * order is a question nobody asks of an event log, and leaving it open would
 * mean an index for each.
 */

export const ACTIVITY_LIST_SPEC = {
  sortable: ["createdAt"] as const,
  defaultSort: "createdAt" as const,
  defaultDirection: "desc" as const,
};

export interface ActivityFilters {
  verb?: ActivityVerb;
  /** All verbs whose group matches — `lesson` covers `lesson.viewed` and the rest. */
  group?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

export interface ActivityRow {
  id: string;
  verb: ActivityVerb;
  objectType: string | null;
  objectId: string | null;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  /** Null for every reader without `activity:read_pii` — see below. */
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface ActivityPage {
  rows: ActivityRow[];
  total: number;
  pages: number;
}

function filtersOf(params: ListParams<"createdAt">, filters: ActivityFilters) {
  const clauses: (SQL | undefined)[] = [];

  if (filters.verb) clauses.push(eq(activityEvents.verb, filters.verb));

  // A LIKE on an enum column needs a cast; `verb::text LIKE 'lesson.%'` is
  // what makes "show me everything about lessons" one filter rather than six.
  if (filters.group) {
    clauses.push(
      sql`${activityEvents.verb}::text like ${`${filters.group}.%`}`,
    );
  }

  if (filters.actorId)
    clauses.push(eq(activityEvents.actorId, filters.actorId));
  if (filters.from) clauses.push(gte(activityEvents.createdAt, filters.from));
  if (filters.to) clauses.push(lte(activityEvents.createdAt, filters.to));

  if (params.query) {
    const pattern = `%${params.query}%`;
    clauses.push(
      sql`(${users.email} ilike ${pattern} or ${users.name} ilike ${pattern} or ${activityEvents.objectId} ilike ${pattern})`,
    );
  }

  return clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;
}

/**
 * A page of events.
 *
 * `canSeePii` decides what the SELECT asks for, not what the template renders.
 * #19 is explicit that a reader without the permission gets the columns null
 * **from the query** — hiding them in the markup would still put them in the
 * RSC payload, in the browser's memory and in any screenshot, which is not
 * withholding personal data, it is styling it out of view.
 */
export async function listActivity(
  params: ListParams<"createdAt">,
  filters: ActivityFilters,
  canSeePii: boolean,
): Promise<ActivityPage> {
  const db = getDb();
  const where = filtersOf(params, filters);

  const [{ total }] = await db
    .select({ total: count() })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(where);

  const rows = await db
    .select({
      id: activityEvents.id,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      metadata: activityEvents.metadata,
      actorId: activityEvents.actorId,
      actorName: users.name,
      actorEmail: users.email,
      ipAddress: canSeePii
        ? activityEvents.ipAddress
        : sql<null>`null::text`.as("ip_address"),
      userAgent: canSeePii
        ? activityEvents.userAgent
        : sql<null>`null::text`.as("user_agent"),
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(where)
    // Newest first, with the id as a tiebreak: two events in the same
    // millisecond would otherwise swap between pages and make one appear
    // twice or not at all. The ids are UUID v7, so they order by time too.
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(params.pageSize)
    .offset(offsetFor(params.page, params.pageSize, total ?? 0));

  return {
    rows: rows as ActivityRow[],
    total: total ?? 0,
    pages: pageCount(total ?? 0, params.pageSize),
  };
}

/** The `?verb=` filter, validated against the closed list. */
export function parseVerbFilter(
  raw: string | string[] | undefined,
): ActivityVerb | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && isActivityVerb(value) ? value : undefined;
}
