/**
 * Keyset cursors, encoded so the shape can change without breaking clients.
 *
 * **Never `OFFSET`.** `OFFSET 200 LIMIT 20` makes Postgres walk and discard
 * 200 rows, so page 20 of a busy thread is a scan — but the performance is the
 * lesser problem. Offset is *incorrect* under concurrent writes: a comment
 * inserted at the top while somebody is on page 3 shifts every later row down
 * one, so they see a duplicate at every page boundary and miss one whenever a
 * comment is deleted. On an infinite feed with live insertions that is a
 * visible bug, not a theoretical one.
 *
 * A keyset cursor names a ROW, not a position, so nothing shifts under it.
 *
 * Pure, and opaque on the wire: base64url of JSON. Opaque so a client cannot
 * come to depend on the fields, and so adding one later is not a breaking
 * change.
 */

/** Newest-first feeds order by `(created_at, id)`. `id` is the tiebreaker
 * because two comments can share a millisecond. */
export interface TimeCursor {
  kind: "time";
  createdAt: string;
  id: string;
}

/**
 * `top` orders by score, and is a SNAPSHOT sort: the score is captured when
 * the first page is read and carried in the cursor. Without that a comment
 * gaining votes mid-scroll moves between pages, and the reader sees it twice
 * or not at all — the same failure offset has, arriving by a different route.
 */
export interface ScoreCursor {
  kind: "score";
  score: number;
  id: string;
}

export type Cursor = TimeCursor | ScoreCursor;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decodes, returning null for anything that is not a cursor we issued.
 *
 * Null rather than throwing, and validated field by field: a tampered cursor
 * must produce a 400, never a 500 and never an unbounded scan. A cursor is
 * attacker-controlled input that goes straight into a WHERE clause, so the
 * types are checked before it gets near one.
 */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;

    if (candidate.kind === "time") {
      if (
        typeof candidate.createdAt !== "string" ||
        typeof candidate.id !== "string" ||
        // A date the database cannot compare is a 500 waiting to happen.
        Number.isNaN(Date.parse(candidate.createdAt))
      ) {
        return null;
      }
      return {
        kind: "time",
        createdAt: candidate.createdAt,
        id: candidate.id,
      };
    }

    if (candidate.kind === "score") {
      if (
        typeof candidate.score !== "number" ||
        !Number.isFinite(candidate.score) ||
        typeof candidate.id !== "string"
      ) {
        return null;
      }
      return { kind: "score", score: candidate.score, id: candidate.id };
    }

    return null;
  } catch {
    return null;
  }
}

/** Page sizes, bounded. An unbounded `limit` is a way to ask for the whole
 * table in one request. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export function pageSize(
  requested: string | number | null | undefined,
): number {
  const value = typeof requested === "string" ? Number(requested) : requested;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}
