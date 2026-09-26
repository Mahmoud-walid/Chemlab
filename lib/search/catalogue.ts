import { tokenize } from "./normalize";

/**
 * Searching a catalogue that is already in memory.
 *
 * Both reader-facing catalogues — lessons and quizzes — are loaded whole by
 * their page (`listLessons`, `listQuizzes`), and this searches that array
 * rather than issuing a query. That is a deliberate choice with a stated
 * expiry, because the alternative is not obviously worse:
 *
 * - **It cannot produce a stale result.** A search that round-trips has to
 *   handle responses arriving out of order; typing `acids` and seeing the
 *   results for `acid` is the classic way a search box lies, and it is
 *   unreachable when the answer is computed synchronously from props.
 * - **Postgres cannot do the Arabic half.** A stock server has no Arabic
 *   text-search configuration, so `to_tsvector` would fall back to `simple`:
 *   no folding of harakat, no alef or taa-marbuta variants, no matching at
 *   all for the spellings `normalize.ts` exists to reconcile. Doing it in SQL
 *   would mean a WORSE search, not a faster one.
 * - **It is exhaustively testable.** Pure input, pure output, no database and
 *   no network, which is where `tests/README.md` says this kind of logic goes.
 *
 * What it is not is a plan for a thousand lessons. The catalogue is tens of
 * rows; when the page stops loading it whole, this moves behind a cursor-paged
 * endpoint and the folding above comes with it as the query normaliser.
 */

/** One searchable part of an item, and how much a hit in it counts. */
export interface SearchField<T> {
  /** The text to search. Return "" for an item that has none. */
  read: (item: T) => string;
  /**
   * Relative importance. A title hit means more than a description hit: the
   * reader typed a name, and an item whose body merely mentions it ranking
   * above the item actually called that is the search feeling wrong.
   */
  weight: number;
}

/** How well one field token answered one query token. Higher is better. */
const MATCH_EXACT = 3;
const MATCH_PREFIX = 2;
const MATCH_INFIX = 1;

/**
 * The score for one query token against one item, or 0 for no match anywhere.
 *
 * Substring matching, not prefix only — and for Arabic that is a requirement
 * rather than generosity. The definite article is written joined to the word,
 * so `الكيمياء` is a single token and a reader searching `كيمياء` is searching
 * for its middle. Prefix-only matching would return nothing for the most
 * natural query anybody could type.
 *
 * The three tiers keep that from costing precision: the whole word still beats
 * the start of a word, which still beats the inside of one. Only the ranking
 * is affected, never whether an item is shown.
 */
function scoreToken<T>(
  item: T,
  fields: SearchField<T>[],
  queryToken: string,
): number {
  let best = 0;
  for (const field of fields) {
    for (const token of tokenize(field.read(item))) {
      let quality = 0;
      if (token === queryToken) quality = MATCH_EXACT;
      else if (token.startsWith(queryToken)) quality = MATCH_PREFIX;
      else if (token.includes(queryToken)) quality = MATCH_INFIX;
      if (quality === 0) continue;
      const score = quality * field.weight;
      if (score > best) best = score;
    }
  }
  return best;
}

/**
 * The items matching `query`, best first.
 *
 * Every query token has to match something — AND, not OR. `acid base` must
 * mean "about both", because OR makes a longer query return MORE results,
 * which is the opposite of what typing more words is for.
 *
 * An empty or punctuation-only query returns the input array **unchanged, by
 * identity**. Two things depend on that: the catalogue keeps its curriculum
 * order when nobody is searching (relevance order would scramble lesson 1
 * through 14 for no reason), and the infinite-scroll reveal can use the array
 * identity to tell "the list changed" from "the list re-rendered".
 */
export function searchCatalogue<T>({
  items,
  query,
  fields,
}: {
  items: readonly T[];
  query: string;
  fields: SearchField<T>[];
}): readonly T[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return items;

  const scored: { item: T; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    let total = 0;
    for (const queryToken of queryTokens) {
      const score = scoreToken(item, fields, queryToken);
      // One unmatched word rejects the item. Scoring the rest first and
      // thresholding later would rank a half-match above nothing, and "nothing
      // matches all of that" is a true and useful answer.
      if (score === 0) return;
      total += score;
    }
    scored.push({ item, score: total, order });
  });

  // `order` as the tiebreak rather than relying on sort stability: it makes
  // equal-scoring items keep catalogue order explicitly, which is the property
  // being promised, not a property of the engine.
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((entry) => entry.item);
}
