import { sql, type SQL } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

/**
 * Reading and writing translation workflow state.
 *
 * The one rule everything here exists to enforce: **a translation's
 * `source_hash` is never computed in TypeScript.** The authoritative value is
 * the generated column on the source row, and it is copied from there — by a
 * subquery inside the same statement — so the two can never be produced by
 * two different implementations of the same hash. A second implementation is
 * how a whole catalogue silently reads as stale after a refactor nobody
 * connected to translations.
 */

/** A source table that carries the generated fingerprint. */
type HashedSource = AnyPgTable & { id: PgColumn; sourceHash: PgColumn };

/**
 * The source row's own fingerprint, as a scalar subquery.
 *
 * Used as the value of a translation's `source_hash` on insert and update. In
 * a transaction that has just written the source, this reads what was written
 * — the same statement's view — so a create and its default-locale mirror row
 * cannot disagree even for an instant.
 */
export function currentSourceHash(
  source: HashedSource,
  id: string,
): SQL<string> {
  return sql<string>`(select ${source.sourceHash} from ${source} where ${source.id} = ${id})`;
}

/**
 * Whether a translation was made from the source as it stands.
 *
 * `IS DISTINCT FROM` rather than `<>`: a null on either side must read as
 * "different", and `<>` answers null, which a WHERE clause then drops. A
 * stale translation that vanishes from the stale filter is the exact bug this
 * whole feature exists to prevent.
 */
export function isStale(
  translationHash: PgColumn,
  sourceHash: PgColumn,
): SQL<boolean> {
  return sql<boolean>`${translationHash} is distinct from ${sourceHash}`;
}

/**
 * The two columns every reader query needs alongside the translated text.
 *
 * Spread into a `.select()` so the status check and the staleness comparison
 * travel together with the join that produced them. Selecting one and
 * forgetting the other is how a draft translation reaches a reader.
 */
export function translationState(
  translation: { status: PgColumn; sourceHash: PgColumn },
  source: { sourceHash: PgColumn },
) {
  return {
    translationStatus: translation.status,
    translationStale: isStale(translation.sourceHash, source.sourceHash),
  };
}
