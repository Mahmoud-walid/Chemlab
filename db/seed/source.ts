/**
 * The seed's input: the JSON files in `data/`.
 *
 * They stay the source of truth until the admin panel can edit content —
 * version-controlled, diffable and reviewable in a pull request, which a
 * database dump is not. Both the seed and the verifier read through here so
 * they cannot disagree about what "the content" is.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ElementJson, LessonJson, QuizJson } from "./transform";

/**
 * A section is authored EITHER as plain text or as blocks, never both.
 *
 * `body` is prose with blank lines between paragraphs — the shape the original
 * content was written in, and the right one for text that is only text.
 * `blocks` is the full block model, for a section that needs a callout, a list
 * or an image. Keeping plain text as an option means the thirteen lessons that
 * are only prose do not have to be re-authored as JSON trees.
 */
export interface LessonSectionSourceJson {
  heading: string;
  body?: string;
  blocks?: unknown[];
}

export interface LessonBodyJson {
  slug: string;
  sections: LessonSectionSourceJson[];
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
  const [elements, lessons, quizzes, bodies] = await Promise.all([
    readJson<ElementJson[]>("periodic-table-detailed.json"),
    readJson<LessonJson[]>("lessons.json"),
    readJson<QuizJson[]>("quiz.json"),
    loadLessonBodies(),
  ]);

  return { elements, lessons, quizzes, bodies };
}

/**
 * Every file in `data/lessons/`, keyed by the slug INSIDE the file rather than
 * by its filename — the filename is a convenience, the slug is the identity,
 * and a rename that changed which lesson a body belonged to would be silent.
 *
 * Reading the directory rather than a hard-coded list means writing a lesson
 * body is adding a file, not adding a file and remembering to import it.
 */
async function loadLessonBodies(): Promise<Map<string, LessonBodyJson>> {
  const entries = await readdir(path.join(DATA, "lessons"));
  const files = entries.filter((name) => name.endsWith(".json")).sort();

  const bodies = await Promise.all(
    files.map((name) => readJson<LessonBodyJson>("lessons", name)),
  );

  return new Map(bodies.map((body) => [body.slug, body]));
}
