import { describe, expect, it } from "vitest";
import lessons from "@/data/lessons.json";

interface Lesson {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  references?: string[];
}

const data = lessons as Lesson[];

describe("data/lessons.json", () => {
  it("is a non-empty list", () => {
    expect(data.length).toBeGreaterThan(0);
  });

  it("has unique slugs", () => {
    const slugs = data.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(data.map((l) => [l.slug, l] as const))(
    "%s has the fields the lesson card renders",
    (slug, lesson) => {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(lesson.title.trim()).not.toBe("");
      expect(lesson.description.trim()).not.toBe("");
      expect(["easy", "medium", "hard"]).toContain(lesson.difficulty);
      expect(lesson.category.trim()).not.toBe("");
    },
  );
});
