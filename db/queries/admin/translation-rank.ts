import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

import { TRANSLATION_RANK } from "@/lib/translations/state";

/**
 * How translated one row is, as the rank `lib/translations/state.ts` defines.
 *
 * In SQL rather than in TypeScript because the admin list **filters** on it:
 * "show me everything still missing in Arabic" has to narrow before paging,
 * and a rank computed after the page is fetched would filter one page at a
 * time. The ladder itself stays in one place — these fragments read the same
 * `TRANSLATION_RANK` the UI does, so the two cannot drift.
 *
 * `greatest()` over the parts is what lets one query answer for a lesson and
 * all of its sections at once: worst part wins, which is the only honest
 * answer for a column an editor scans.
 */

const R = TRANSLATION_RANK;

/**
 * The rank of a single translation row, joined against its source.
 *
 * `translation` is the LEFT-joined side, so every column of it is null when
 * no translation exists — which is exactly `missing`.
 */
export function rowRank(
  translation: { id: PgColumn; status: PgColumn; sourceHash: PgColumn },
  source: { sourceHash: PgColumn },
): SQL<number> {
  return sql<number>`
    case
      when ${translation.id} is null then ${R.missing}
      when ${translation.status} = 'draft' then ${R.draft}
      when ${translation.status} = 'in_review' then ${R.in_review}
      when ${translation.sourceHash} is distinct from ${source.sourceHash}
        then ${R.stale}
      else ${R.published}
    -- Cast: the arms are bound parameters, which Postgres types as 'unknown'
    -- and then resolves to text. coalesce(text, 0) is a type error, and it is
    -- one that only appears once the expression is composed — the CASE alone
    -- runs fine.
    end::int
  `;
}

/**
 * The worst rank across a set of child rows, as a derived table keyed on the
 * parent.
 *
 * Aggregated in SQL rather than by fetching the children: a lesson with forty
 * sections would otherwise cost forty rows per row of the list.
 *
 * `max(...)` and not `greatest(...)` here — `greatest` compares its arguments,
 * `max` aggregates down a column, and the two are easy to confuse into a
 * query that silently reports the first child's state as the whole lesson's.
 *
 * A parent with no children gets no row at all, so the caller's left join
 * yields null. That must read as `published` (nothing is untranslated), which
 * is why every caller coalesces to zero rather than to `R.missing`.
 */
export function childRankExpression(
  translation: { id: PgColumn; status: PgColumn; sourceHash: PgColumn },
  source: { sourceHash: PgColumn },
): SQL<number> {
  return sql<number>`max(${rowRank(translation, source)})`;
}

/** `greatest(a, b)`, with nulls read as "nothing outstanding". */
export function worstRank(...ranks: SQL<number>[]): SQL<number> {
  const coalesced = ranks.map((rank) => sql`coalesce(${rank}, 0)`);
  return sql<number>`greatest(${sql.join(coalesced, sql`, `)})`;
}

/** Marker so a table alias is accepted where drizzle wants a relation. */
export type RankSource = AnyPgTable;
