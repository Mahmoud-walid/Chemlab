/**
 * Deterministic shuffling for an attempt.
 *
 * Two properties matter, and the code the quiz page ships today has neither.
 *
 * **Uniform.** `[...arr].sort(() => Math.random() - 0.5)` is not a shuffle.
 * The comparator is inconsistent — it can claim a < b and b < a in the same
 * sort — so the resulting distribution depends on the engine's sort algorithm
 * and is biased toward the identity permutation. For a quiz, where an option's
 * position measurably affects how often it is chosen, that is a fairness
 * problem rather than a nitpick. `tests/lib/exam-shuffle.test.ts` measures it.
 *
 * **Reproducible.** A resumed attempt has to show the same order, on any
 * device, in any process. Storing the materialised permutation would work but
 * costs a column per attempt and goes stale the moment a question is deleted.
 * A seed does not: three integers regenerate the order exactly.
 *
 * Pure, so the server and the browser derive the same order from the same
 * seed without either telling the other what it is.
 */

/**
 * mulberry32: a 32-bit PRNG in six lines, with a period of 2^32 and a
 * distribution good enough for shuffling a paper.
 *
 * `Math.random()` cannot be used here because it cannot be seeded — the whole
 * point is that the same seed yields the same order. A cryptographic generator
 * is the wrong tool for the opposite reason: nothing here is a secret, and one
 * would still need a seed to be reproducible.
 */
export function mulberry32(seed: number): () => number {
  // Coerced to a 32-bit integer so a float or a negative seed still produces a
  // stable sequence rather than a subtly different one per platform.
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates, seeded. Returns a new array; the input is untouched.
 *
 * Walks from the end and swaps each element with one at or before it — every
 * permutation exactly once, with equal probability, given a uniform source.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The order of one question's options, derived from the attempt seed and the
 * question's own position.
 *
 * Mixed with the position rather than reusing the attempt seed directly: the
 * same seed applied to every question would shuffle a four-option question the
 * same way each time, so a candidate who noticed that the answer to question 1
 * moved from slot 2 to slot 4 would know the same happened to every other
 * question. The multiplier is an odd constant so distinct positions cannot
 * collide onto the same derived seed.
 */
export function optionSeed(
  attemptSeed: number,
  questionPosition: number,
): number {
  return (attemptSeed + questionPosition * 0x9e3779b1) | 0;
}

/** A seed for a new attempt. Not a secret — it only has to differ per attempt. */
export function newSeed(): number {
  return (Math.random() * 0x100000000) | 0;
}
