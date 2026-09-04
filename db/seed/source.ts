/**
 * The seed's input: the JSON files in `data/`.
 *
 * They stay the source of truth until the admin panel can edit content —
 * version-controlled, diffable and reviewable in a pull request, which a
 * database dump is not. Both the seed and the verifier read through here so
 * they cannot disagree about what "the content" is.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ElementJson, LessonJson, QuizJson } from "./transform";

export interface LessonBodyJson {
  slug: string;
  sections: { heading: string; body: string }[];
}

export interface SeedSource {
  elements: ElementJson[];
  lessons: LessonJson[];
  quizzes: QuizJson[];
  /** Lesson bodies, keyed by lesson slug. Most lessons have none yet. */
  bodies: Map<string, LessonBodyJson>;
}

const DATA = path.join(process.cwd(), "data");

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA, ...segments), "utf8")) as T;
}

export async function loadSeedSource(): Promise<SeedSource> {
  const [elements, lessons, quizzes, introduction] = await Promise.all([
    readJson<ElementJson[]>("periodic-table-detailed.json"),
    readJson<LessonJson[]>("lessons.json"),
    readJson<QuizJson[]>("quiz.json"),
    readJson<LessonBodyJson>("lessons", "introduction-basics.json"),
  ]);

  return {
    elements,
    lessons,
    quizzes,
    bodies: new Map([[introduction.slug, introduction]]),
  };
}
