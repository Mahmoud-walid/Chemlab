import { describe, expect, it } from "vitest";

import {
  readingTimeMinutes,
  readingTimeSeconds,
  SECONDS_PER_IMAGE,
  WORDS_PER_MINUTE,
} from "@/lib/lessons/reading-time";
import type { LessonBlock } from "@/lib/lessons/blocks";

const words = (count: number): LessonBlock => ({
  id: "p",
  type: "paragraph",
  text: [{ text: Array.from({ length: count }, () => "word").join(" ") }],
});

describe("readingTimeSeconds", () => {
  it("is zero for an empty lesson", () => {
    expect(readingTimeSeconds([])).toBe(0);
  });

  it("matches the words-per-minute figure", () => {
    expect(readingTimeSeconds([words(WORDS_PER_MINUTE)])).toBe(60);
  });

  it("adds a flat estimate per image", () => {
    const withImage: LessonBlock = {
      id: "i",
      type: "image",
      url: "https://res.cloudinary.com/demo/image/upload/x.png",
      alt: "",
    };
    expect(readingTimeSeconds([words(WORDS_PER_MINUTE), withImage])).toBe(
      60 + SECONDS_PER_IMAGE,
    );
  });

  it("uses a video's real duration, and skips it when unknown", () => {
    // A guess for a video is a guess between a ten-second clip and a
    // forty-minute lecture. No number beats a wrong one.
    const url = "https://res.cloudinary.com/demo/video/upload/x.mp4";
    const timed: LessonBlock = {
      id: "v",
      type: "video",
      url,
      durationSeconds: 90,
    };
    const untimed: LessonBlock = { id: "w", type: "video", url };
    expect(readingTimeSeconds([timed])).toBe(90);
    expect(readingTimeSeconds([untimed])).toBe(0);
  });

  it("is within 5% of a hand-computed figure for a realistic lesson", () => {
    // #20's acceptance criterion, computed by hand: 660 words is exactly
    // three minutes at 220 wpm, plus two images at 12s.
    const blocks: LessonBlock[] = [
      words(660),
      {
        id: "i1",
        type: "image",
        url: "https://res.cloudinary.com/demo/image/upload/a.png",
        alt: "",
      },
      {
        id: "i2",
        type: "image",
        url: "https://res.cloudinary.com/demo/image/upload/b.png",
        alt: "",
      },
    ];
    const expected = 180 + 2 * SECONDS_PER_IMAGE;
    const actual = readingTimeSeconds(blocks);
    expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.05);
  });
});

describe("readingTimeMinutes", () => {
  it("never reports zero minutes", () => {
    // "0 min read" reads as an error, not as a short lesson.
    expect(readingTimeMinutes(0)).toBe(1);
    expect(readingTimeMinutes(5)).toBe(1);
  });

  it("rounds to the nearest minute", () => {
    expect(readingTimeMinutes(200)).toBe(3);
  });
});
