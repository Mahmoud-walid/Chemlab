/**
 * Pure JSON → row transformations for the seed.
 *
 * Deliberately free of any database import so the mapping — where the data
 * errors actually live — is unit-testable without Postgres. The seed script
 * does the I/O; this file decides what the rows should be.
 */
import { blocksSchema, type LessonBlock } from "@/lib/lessons/blocks";

export type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export function assertDifficulty(value: string, context: string): Difficulty {
  if (!DIFFICULTIES.includes(value as Difficulty)) {
    throw new Error(
      `${context}: "${value}" is not a difficulty (${DIFFICULTIES.join(", ")})`,
    );
  }
  return value as Difficulty;
}

// ── Elements ────────────────────────────────────────────────────────────────

export interface ElementJson {
  number: number;
  symbol: string;
  name: string;
  atomic_mass: number;
  category: string;
  period: number;
  xpos: number;
  ypos: number;
  phase: string;
  appearance: string | null;
  color: string | null;
  density: number | null;
  melt: number | null;
  boil: number | null;
  molar_heat: number | null;
  electron_affinity: number | null;
  electronegativity_pauling: number | null;
  electron_configuration: string;
  electron_configuration_semantic: string;
  shells: number[];
  ionization_energies: number[];
  summary: string;
  source: string;
  spectral_img: string | null;
  discovered_by: string | null;
  named_by: string | null;
}

export function toElementRow(json: ElementJson) {
  if (!Number.isInteger(json.number) || json.number < 1) {
    throw new Error(`element "${json.name}": invalid atomic number`);
  }
  if (json.shells.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`element ${json.symbol}: shells must be positive integers`);
  }

  return {
    number: json.number,
    symbol: json.symbol,
    name: json.name,
    atomicMass: json.atomic_mass,
    category: json.category,
    period: json.period,
    xpos: json.xpos,
    ypos: json.ypos,
    phase: json.phase,
    appearance: json.appearance,
    color: json.color,
    density: json.density,
    melt: json.melt,
    boil: json.boil,
    molarHeat: json.molar_heat,
    electronAffinity: json.electron_affinity,
    electronegativityPauling: json.electronegativity_pauling,
    electronConfiguration: json.electron_configuration,
    electronConfigurationSemantic: json.electron_configuration_semantic,
    shells: json.shells,
    ionizationEnergies: json.ionization_energies,
    summary: json.summary,
    source: json.source,
    spectralImg: json.spectral_img,
    discoveredBy: json.discovered_by,
    namedBy: json.named_by,
  };
}

// ── Lessons ─────────────────────────────────────────────────────────────────

export interface LessonJson {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  references?: string[];
}

export function toLessonRow(json: LessonJson) {
  return {
    slug: json.slug,
    title: json.title,
    description: json.description,
    difficulty: assertDifficulty(json.difficulty, `lesson "${json.slug}"`),
    category: json.category,
    references: json.references ?? [],
  };
}

/**
 * Turns a plain-text body into blocks.
 *
 * One-way and lossless: blank lines separate paragraphs, and the text survives
 * verbatim inside them. The seed's prose has no emphasis, images or links, so
 * every block it produces is a paragraph — but the column is already the shape
 * the editor writes, so a lesson edited in the admin panel and a lesson from
 * the seed are the same kind of document.
 *
 * Block ids are derived from the section key and the paragraph's position
 * rather than generated randomly, because **re-running the seed must not
 * change them**. A translation addresses a block by id; random ids would mean
 * every re-seed orphans every translation.
 */
export function textToBlocks(body: string, keyPrefix: string): LessonBlock[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (paragraphs.length > 0 ? paragraphs : [""]).map((text, index) => ({
    id: `${keyPrefix}-p${index + 1}`,
    type: "paragraph" as const,
    text: text ? [{ text }] : [],
  }));
}

/** Recovers the plain text from blocks produced by `textToBlocks`. */
export function blocksToPlainText(blocks: LessonBlock[]): string {
  return blocks
    .map((block) =>
      block.type === "paragraph"
        ? block.text.map((run) => run.text).join("")
        : "",
    )
    .join("\n\n");
}

export interface LessonSectionJson {
  heading: string;
  /** Prose, blank lines between paragraphs. Absent when `blocks` is used. */
  body?: string;
  /** Authored blocks, validated here rather than trusted. */
  blocks?: unknown[];
}

/**
 * `slug` is part of the block-id prefix so ids are unique across lessons and
 * stable across re-seeds — see `textToBlocks`.
 */
export function toLessonSectionRows(
  slug: string,
  sections: LessonSectionJson[],
) {
  return sections.map((section, index) => {
    const prefix = `${slug}-s${index + 1}`;

    // Authored blocks go through the same schema an editor's write does. The
    // seed is content somebody typed into a file, not privileged input, and a
    // malformed block that reaches the column renders as a gap on the page
    // with nothing saying why.
    const blocks = section.blocks
      ? blocksSchema.parse(withIds(section.blocks, prefix))
      : textToBlocks(section.body ?? "", prefix);

    return { position: index, heading: section.heading, body: blocks };
  });
}

/**
 * Fills in a block id where the author left one out.
 *
 * Derived from position, like `textToBlocks`, so re-seeding is stable —
 * an author who does supply an id keeps it, which is what makes a block's
 * translation survive being moved.
 */
function withIds(blocks: unknown[], prefix: string): unknown[] {
  return blocks.map((block, index) => {
    const record = block as Record<string, unknown>;
    return record.id ? record : { ...record, id: `${prefix}-b${index + 1}` };
  });
}

// ── Quizzes ─────────────────────────────────────────────────────────────────

export interface QuizQuestionJson {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface QuizJson {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  questions: QuizQuestionJson[];
}

export function toQuizRow(json: QuizJson) {
  return {
    slug: json.slug,
    title: json.title,
    description: json.description,
    difficulty: assertDifficulty(json.difficulty, `quiz "${json.slug}"`),
    category: json.category,
  };
}

/**
 * Resolves the JSON's stringly-typed `answer` into the option's position.
 *
 * This is the migration's whole point: the answer stops being a copy of an
 * option's text and becomes a reference to it. Anything the database will
 * later enforce with a foreign key has to be provably resolvable here first,
 * so a mismatch fails the seed loudly rather than seeding a broken quiz.
 */
export function toQuestionRows(quiz: QuizJson) {
  return quiz.questions.map((question, position) => {
    const options = question.options;

    if (new Set(options).size !== options.length) {
      throw new Error(
        `quiz "${quiz.slug}" question ${position + 1}: duplicate options make the answer ambiguous`,
      );
    }

    const correctIndex = options.indexOf(question.answer);
    if (correctIndex === -1) {
      throw new Error(
        `quiz "${quiz.slug}" question ${position + 1}: answer "${question.answer}" is not one of its options`,
      );
    }

    return {
      position,
      prompt: question.question,
      explanation: question.explanation,
      correctOptionPosition: correctIndex,
      options: options.map((label, optionPosition) => ({
        position: optionPosition,
        label,
      })),
    };
  });
}
