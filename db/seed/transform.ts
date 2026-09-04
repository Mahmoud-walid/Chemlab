/**
 * Pure JSON → row transformations for the seed.
 *
 * Deliberately free of any database import so the mapping — where the data
 * errors actually live — is unit-testable without Postgres. The seed script
 * does the I/O; this file decides what the rows should be.
 */
import type { RichTextDoc } from "@/db/schema/content";

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
 * Wraps a plain-text body in a minimal ProseMirror document.
 *
 * One-way and lossless: blank lines separate paragraphs, and the text survives
 * verbatim inside them. Existing lesson prose renders identically, while the
 * column is already the right shape for the rich editor that arrives later.
 */
export function textToRichText(body: string): RichTextDoc {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    type: "doc",
    content: (paragraphs.length > 0 ? paragraphs : [""]).map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}

/** Recovers the plain text from a document produced by `textToRichText`. */
export function richTextToText(doc: RichTextDoc): string {
  return (doc.content ?? [])
    .map((node) => {
      const content = (node as { content?: { text?: string }[] }).content ?? [];
      return content.map((child) => child.text ?? "").join("");
    })
    .join("\n\n");
}

export interface LessonSectionJson {
  heading: string;
  body: string;
}

export function toLessonSectionRows(sections: LessonSectionJson[]) {
  return sections.map((section, index) => ({
    position: index,
    heading: section.heading,
    body: textToRichText(section.body),
  }));
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
