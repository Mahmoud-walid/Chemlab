import { describe, expect, it } from "vitest";

import {
  mulberry32,
  newSeed,
  optionSeed,
  shuffleWithSeed,
} from "@/lib/exams/shuffle";

const items = ["a", "b", "c", "d", "e"];

describe("the seeded generator", () => {
  it("produces the same sequence for the same seed", () => {
    const first = Array.from({ length: 10 }, mulberry32(42));
    const second = Array.from({ length: 10 }, mulberry32(42));
    expect(first).toEqual(second);
  });

  it("produces a different sequence for a different seed", () => {
    expect(Array.from({ length: 5 }, mulberry32(1))).not.toEqual(
      Array.from({ length: 5 }, mulberry32(2)),
    );
  });

  it("stays inside [0, 1)", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("survives a negative or fractional seed", () => {
    // `newSeed` cannot produce one, but a seed read back from the database
    // could be anything an earlier version wrote.
    expect(() => mulberry32(-1)()).not.toThrow();
    expect(mulberry32(1.5)()).toBe(mulberry32(1)());
  });
});

describe("shuffleWithSeed", () => {
  it("is a permutation — nothing added, nothing lost", () => {
    const shuffled = shuffleWithSeed(items, 99);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("does not mutate its input", () => {
    const original = [...items];
    shuffleWithSeed(items, 3);
    expect(items).toEqual(original);
  });

  it("reproduces the same order from the same seed", () => {
    // The property a resumed attempt depends on: same seed, same paper, on
    // any device and in any process.
    expect(shuffleWithSeed(items, 12345)).toEqual(
      shuffleWithSeed(items, 12345),
    );
  });

  it("handles an empty list and a single item", () => {
    expect(shuffleWithSeed([], 1)).toEqual([]);
    expect(shuffleWithSeed(["only"], 1)).toEqual(["only"]);
  });
});

/**
 * The regression fixture the engine exists for.
 *
 * `sort(() => Math.random() - 0.5)` — what the quiz page ships today — is not
 * a shuffle: the comparator is inconsistent, so the distribution depends on
 * V8's sort and leans hard toward leaving elements where they started. On a
 * quiz, where option position measurably affects how often an option is
 * picked, that is a fairness problem.
 *
 * Both are measured here so the claim is demonstrated rather than asserted.
 */
describe("uniformity", () => {
  const N = 4;
  const RUNS = 60_000;

  /** How often each item lands in each slot. */
  function positionCounts(shuffle: (input: number[]) => number[]) {
    const counts = Array.from({ length: N }, () => new Array(N).fill(0));
    const input = Array.from({ length: N }, (_, i) => i);
    for (let run = 0; run < RUNS; run++) {
      const out = shuffle(input);
      out.forEach((value, slot) => counts[value][slot]++);
    }
    return counts;
  }

  /** Chi-square against a uniform expectation of RUNS/N per cell. */
  function chiSquare(counts: number[][]): number {
    const expected = RUNS / N;
    let total = 0;
    for (const row of counts) {
      for (const observed of row) {
        total += (observed - expected) ** 2 / expected;
      }
    }
    return total;
  }

  it("places every item in every slot about equally often", () => {
    let seed = 1;
    const counts = positionCounts((input) => shuffleWithSeed(input, seed++));
    // 9 degrees of freedom ((4-1)^2); the 99.9th percentile is 27.88. A
    // generous ceiling, because this must not fail on an unlucky run.
    expect(chiSquare(counts)).toBeLessThan(40);
  });

  it("shows the old comparator shuffle failing the same test", () => {
    // Kept as a demonstration, not a guard: if this ever starts passing it
    // means V8 changed its sort, not that the comparator became correct.
    const counts = positionCounts((input) =>
      [...input].sort(() => Math.random() - 0.5),
    );
    expect(chiSquare(counts)).toBeGreaterThan(100);
  });
});

describe("per-question option seeds", () => {
  it("gives each question position a different order", () => {
    // Reusing the attempt seed for every question would shuffle each
    // four-option question identically, so noticing where one answer moved
    // would reveal where the others moved too.
    const a = shuffleWithSeed(items, optionSeed(500, 0));
    const b = shuffleWithSeed(items, optionSeed(500, 1));
    expect(a).not.toEqual(b);
  });

  it("is stable for the same attempt and question", () => {
    expect(optionSeed(500, 3)).toBe(optionSeed(500, 3));
  });

  it("does not collide across nearby positions", () => {
    const seeds = new Set(
      Array.from({ length: 200 }, (_, position) => optionSeed(77, position)),
    );
    expect(seeds.size).toBe(200);
  });
});

describe("newSeed", () => {
  it("returns a 32-bit integer", () => {
    for (let i = 0; i < 100; i++) {
      const seed = newSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(-2147483648);
      expect(seed).toBeLessThanOrEqual(2147483647);
    }
  });

  it("rarely repeats", () => {
    const seeds = new Set(Array.from({ length: 1000 }, newSeed));
    expect(seeds.size).toBeGreaterThan(990);
  });
});
