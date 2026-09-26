/**
 * Folding a string down to what a reader meant, so a search box does not miss.
 *
 * A catalogue search that is wrong is almost never wrong by returning too
 * much — it is wrong by returning nothing for a query the reader can see on
 * the screen. Every rule below exists because of one of those, and the Arabic
 * ones are not cosmetic: the catalogue's own copy is written WITH diacritics
 * (`مقرَّر`, `منظَّمة`), and nobody types them.
 *
 * Deliberately pure, synchronous and dependency-free. It runs on both sides of
 * the render, and it is the piece worth testing exhaustively — a normaliser
 * that drops a letter silently turns into "search is broken sometimes".
 *
 * Every character this module acts on is written as a `\u` escape rather than
 * as itself. Half of them are invisible and the rest are Arabic letters that
 * differ from their neighbours by one mark; a reviewer cannot check a table of
 * those by looking at it, and an editor that normalises the file would change
 * behaviour with no visible diff.
 */

/**
 * Arabic-Indic and extended Arabic-Indic digits, folded onto ASCII.
 *
 * The lesson numbering is rendered in Latin digits on purpose (see
 * `lesson-card.tsx`), but an Arabic keyboard produces `٢`, and a reader
 * typing the number they are looking at in an Arabic paragraph produces the
 * other set again. Both have to find `2`.
 */
const DIGIT_FOLDS: Record<string, string> = {
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9",
  "\u06F0": "0",
  "\u06F1": "1",
  "\u06F2": "2",
  "\u06F3": "3",
  "\u06F4": "4",
  "\u06F5": "5",
  "\u06F6": "6",
  "\u06F7": "7",
  "\u06F8": "8",
  "\u06F9": "9",
};

/**
 * Letter folds that Unicode decomposition does NOT perform.
 *
 * Alef with hamza above (U+0623), below (U+0625), with madda (U+0622), and
 * hamza on waw (U+0648) and on yaa (U+0626) all decompose to a base letter
 * plus a combining hamza, so stripping marks handles them for free. These five
 * do not decompose at all, and each is a spelling readers and writers disagree
 * about:
 *
 * - U+0671, alef wasla, appears in Qur'anic orthography and in pasted text.
 * - U+0629 (taa marbuta) against U+0647 (haa) at the end of a word is the
 *   single most common Arabic typing variant there is.
 * - U+0649 (alef maksura) against U+064A (yaa) is the second.
 * - a bare U+0621 hamza is dropped rather than mapped: the spellings with and
 *   without it should meet, and there is no base letter to map it onto.
 * - U+0640, tatweel, is a letter-shaped stretch with no meaning at all.
 */
const LETTER_FOLDS: Record<string, string> = {
  "\u0671": "\u0627",
  "\u0629": "\u0647",
  "\u0649": "\u064A",
  "\u0640": "",
  "\u0621": "",
};

/** The same five, as a class. Kept beside the table so they cannot drift. */
const FOLDED_LETTERS = /[\u0671\u0629\u0649\u0640\u0621]/g;

const FOLDED_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Zero-width and directional formatting characters.
 *
 * Invisible, and every one of them splits a token in two — a word carrying a
 * zero-width joiner in the middle matches nothing but itself, and nobody
 * looking at either string can see why.
 */
const INVISIBLE = /[\u200B-\u200F\u061C\u2060\uFEFF]/g;

/**
 * The comparable form of a string.
 *
 * Order matters here. NFKD first, so `café` becomes `cafe` plus a mark and
 * alef-with-hamza becomes a bare alef plus a mark; then every combining mark
 * goes, which takes the Latin accents and the Arabic harakat in the same pass;
 * then the folds Unicode does not do; then case.
 *
 * **NFKD, not NFD**, and that is the one choice here worth arguing about. The
 * compatibility decompositions are exactly the ones this catalogue needs: a
 * chemistry title writes water with a subscript two, and under NFD that
 * subscript survives as its own character, so `h2o` finds nothing. NFKD folds
 * it to `2`. It also unpicks the Arabic presentation-form ligatures that
 * arrive in pasted text (U+FEFB back into the two letters it draws), which
 * would otherwise be a word that matches only itself. Compatibility folding
 * loses formatting, and formatting is not what a search index is for.
 *
 * `toLowerCase()` without a locale argument on purpose: the Turkish dotless-i
 * rule would fold `I` to U+0131 for a Turkish reader and stop matching the
 * English catalogue. Search folding is about the data, not the reader's phone.
 */
export function foldText(input: string): string {
  let folded = input.normalize("NFKD").replace(/\p{M}/gu, "");
  folded = folded.replace(INVISIBLE, "");
  folded = folded.replace(
    FOLDED_LETTERS,
    (character) => LETTER_FOLDS[character]!,
  );
  folded = folded.replace(
    FOLDED_DIGITS,
    (character) => DIGIT_FOLDS[character]!,
  );
  return folded.toLowerCase();
}

/**
 * The folded words of a string.
 *
 * Split on everything that is neither a letter nor a number, which is what
 * makes `acid-base`, a subscripted formula, `sodium (Na)` and an Arabic phrase
 * ending in U+060C all tokenise the way a reader would read them aloud. A
 * punctuation-only string yields no tokens, and that is the honest answer
 * rather than one empty token that matches everything.
 */
export function tokenize(input: string): string[] {
  return foldText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}
