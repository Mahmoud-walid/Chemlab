import { sql } from "drizzle-orm";
import {
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

/** Shared by lessons and quizzes; matches `types/quiz.ts`. */
export const difficulty = pgEnum("difficulty", ["easy", "medium", "hard"]);

/**
 * A rich-text document, stored as ProseMirror/TipTap JSON rather than an HTML
 * string. Lessons become Medium-style posts with images, video and callouts:
 * a structured document round-trips losslessly through the editor and renders
 * by a pure function, where HTML would need sanitising on every read and
 * re-parsing on every edit.
 */
export type RichTextDoc = {
  type: "doc";
  content: Array<Record<string, unknown>>;
};

// ── Elements ────────────────────────────────────────────────────────────────

/**
 * `shells` and `ionization_energies` are Postgres arrays, not jsonb and not
 * child tables. They are ordered, homogeneous, positional numeric vectors,
 * always read whole and never queried by member. A child table would explode
 * 119 rows into ~1,500 plus a join and an ORDER BY on every read, to buy a
 * query nobody will write.
 *
 * Trade-off: "elements whose 3rd ionization energy exceeds X" needs array
 * indexing syntax rather than a plain WHERE. Acceptable — the UI reads the
 * whole vector to draw a chart.
 */
export const elements = pgTable(
  "elements",
  {
    id: id(),
    number: integer("number").notNull().unique(), // natural key, 1..119
    symbol: text("symbol").notNull().unique(),
    name: text("name").notNull(),
    atomicMass: doublePrecision("atomic_mass").notNull(),
    // Deliberately text, not an enum: 15 stable values today, but a new
    // category should be a row change rather than a schema migration.
    category: text("category").notNull(),
    period: integer("period").notNull(),
    xpos: integer("xpos").notNull(),
    ypos: integer("ypos").notNull(),
    phase: text("phase").notNull(),
    appearance: text("appearance"),
    color: text("color"),
    density: doublePrecision("density"),
    melt: doublePrecision("melt"),
    boil: doublePrecision("boil"),
    molarHeat: doublePrecision("molar_heat"),
    electronAffinity: doublePrecision("electron_affinity"),
    electronegativityPauling: doublePrecision("electronegativity_pauling"),
    electronConfiguration: text("electron_configuration").notNull(),
    electronConfigurationSemantic: text(
      "electron_configuration_semantic",
    ).notNull(),
    shells: integer("shells").array().notNull(),
    ionizationEnergies: doublePrecision("ionization_energies")
      .array()
      .notNull(),
    summary: text("summary").notNull(),
    source: text("source").notNull(),
    spectralImg: text("spectral_img"),
    discoveredBy: text("discovered_by"),
    namedBy: text("named_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("elements_xy_idx").on(t.xpos, t.ypos)],
);

// ── Lessons ─────────────────────────────────────────────────────────────────

export const lessons = pgTable("lessons", {
  id: id(),
  slug: text("slug").notNull().unique(),
  // Default-locale copy. Other locales live in lesson_translations.
  title: text("title").notNull(),
  description: text("description").notNull(),
  difficulty: difficulty("difficulty").notNull(),
  category: text("category").notNull(),
  references: text("references")
    .array()
    .notNull()
    .default(sql`'{}'`),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // Lessons are soft-deletable: they carry comments, likes and saves that a
  // hard delete would take with them.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const lessonSections = pgTable(
  "lesson_sections",
  {
    id: id(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    body: jsonb("body").$type<RichTextDoc>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("lesson_sections_order_idx").on(t.lessonId, t.position)],
);

// ── Quizzes ─────────────────────────────────────────────────────────────────

export const quizzes = pgTable("quizzes", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  difficulty: difficulty("difficulty").notNull(),
  category: text("category").notNull(),
  ...timestamps,
});

/**
 * `correctOptionId` is the fix for the JSON's biggest data smell: today the
 * answer is a STRING duplicating one of the options, so renaming an option
 * silently orphans the answer — a foreign key wearing a string costume.
 *
 * Nullable in the table definition only to break the circular reference
 * (question → option → question) at type level. The seed populates it inside
 * one transaction and verification asserts no row is left null.
 */
export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    explanation: text("explanation").notNull(),
    correctOptionId: uuid("correct_option_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("quiz_questions_order_idx").on(t.quizId, t.position)],
);

/**
 * `position` makes option order a storage fact; shuffling is then a display
 * decision, which is what lets a resumed attempt show the same order.
 */
export const quizOptions = pgTable(
  "quiz_options",
  {
    id: id(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("quiz_options_order_idx").on(t.questionId, t.position)],
);

// ── Translations ────────────────────────────────────────────────────────────

/**
 * Side-car tables rather than per-locale columns (`title_en`, `title_ar`).
 * Adding a third language becomes data instead of DDL, and a missing
 * translation is an absent row — easy to fall back on — rather than a nullable
 * column every query must remember to check.
 *
 * Trade-off: every content read joins on locale, so the join-with-fallback
 * belongs in one helper rather than at each call site.
 *
 * Only `en` is seeded. Arabic content is the owner's to commission — machine
 * translation of chemistry is how a wrong answer gets marked correct.
 */
export const lessonTranslations = pgTable(
  "lesson_translations",
  {
    id: id(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lesson_translations_locale_idx").on(t.lessonId, t.locale),
  ],
);

export const lessonSectionTranslations = pgTable(
  "lesson_section_translations",
  {
    id: id(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => lessonSections.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    heading: text("heading").notNull(),
    body: jsonb("body").$type<RichTextDoc>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lesson_section_translations_locale_idx").on(
      t.sectionId,
      t.locale,
    ),
  ],
);

export const quizTranslations = pgTable(
  "quiz_translations",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("quiz_translations_locale_idx").on(t.quizId, t.locale)],
);

export const quizQuestionTranslations = pgTable(
  "quiz_question_translations",
  {
    id: id(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    prompt: text("prompt").notNull(),
    explanation: text("explanation").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quiz_question_translations_locale_idx").on(
      t.questionId,
      t.locale,
    ),
  ],
);

// ── Inferred types ──────────────────────────────────────────────────────────

export type Element = typeof elements.$inferSelect;
export type NewElement = typeof elements.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type NewLesson = typeof lessons.$inferInsert;
export type LessonSection = typeof lessonSections.$inferSelect;
export type NewLessonSection = typeof lessonSections.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type NewQuizQuestion = typeof quizQuestions.$inferInsert;
export type QuizOption = typeof quizOptions.$inferSelect;
export type NewQuizOption = typeof quizOptions.$inferInsert;
