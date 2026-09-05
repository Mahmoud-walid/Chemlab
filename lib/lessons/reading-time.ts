import { blocksToText, type LessonBlock } from "./blocks";

/**
 * How long a lesson takes to read, computed once at save time.
 *
 * Stored on the row rather than computed per request — it is the same number
 * for every reader and every request, and recomputing it on each render is
 * work paid for by the reader. Computed on the SERVER rather than in the
 * browser for the same reason a price is: two clients must not disagree.
 *
 * 220 words per minute is the middle of the range measured for adults reading
 * non-fiction on screen. It is an estimate presented as one ("about 6 min"),
 * not a measurement.
 */

export const WORDS_PER_MINUTE = 220;

/** A flat estimate per image: long enough to look at, short enough not to
 * dominate. Medium's own figure decays over a post; a constant is honest
 * about being an estimate rather than pretending to model attention. */
export const SECONDS_PER_IMAGE = 12;

/**
 * A video is not an estimate — its duration is a fact, when we have it. When
 * we do not, it is skipped rather than guessed: a wrong number for a
 * ten-second clip and a forty-minute lecture is worse than no number.
 */
export function readingTimeSeconds(blocks: readonly LessonBlock[]): number {
  const words = countWords(blocksToText(blocks));
  const prose = (words / WORDS_PER_MINUTE) * 60;

  let media = 0;
  for (const block of blocks) {
    if (block.type === "image") media += SECONDS_PER_IMAGE;
    if (block.type === "video") media += block.durationSeconds ?? 0;
  }

  return Math.round(prose + media);
}

/** Minutes, never zero: "0 min read" reads as an error, not as a short
 * lesson, and every lesson takes some time to read. */
export function readingTimeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Splits on whitespace, which counts CJK text badly and Arabic correctly.
 * Arabic is the language that matters here; a CJK locale would need a
 * character-based count, and this is the place it would go.
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}
