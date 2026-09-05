import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
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
import { users } from "./auth";
import type { LessonBlock } from "@/lib/lessons/blocks";

/** Shared by lessons and quizzes; matches `types/quiz.ts`. */
export const difficulty = pgEnum("difficulty", ["easy", "medium", "hard"]);

/**
 * The publication lifecycle every editable content row moves through.
 *
 * An enum rather than a pair of booleans, and rather than inferring the state
 * from `published_at`: "archived" is not the absence of publication, and a
 * nullable timestamp cannot express three states without a second column that
 * can contradict it. `published_at` stays, but only as the record of WHEN a row
 * first went live — the status column is what decides whether it is visible.
 */
export const contentStatus = pgEnum("content_status", [
  "draft",
  "published",
  "archived",
]);

/**
 * Where a translation is in its life, independent of whether the source has
 * moved on since.
 *
 * "missing" is deliberately NOT a value here: a translation that does not
 * exist is an absent row, not a row claiming absence. Storing it would mean
 * every locale of every entity needs a row before anybody has translated
 * anything, and the first thing to drift would be the rows nobody created.
 *
 * "stale" is not a value either, for a stronger reason — see `sourceHash`
 * below. Staleness is a comparison, not a state, and a state that has to be
 * kept in step with a comparison is a state that will eventually disagree
 * with it.
 */
export const translationStatus = pgEnum("translation_status", [
  "draft",
  "in_review",
  "published",
]);

/**
 * A fingerprint of the default-locale fields a translation was made from.
 *
 * `GENERATED ALWAYS ... STORED` on the SOURCE tables, so it cannot be
 * forgotten: Postgres recomputes it inside the same statement that changes
 * the source, which is what makes "editing an English lesson marks its
 * Arabic translation stale, atomically" true by construction rather than by
 * every future write path remembering to do it.
 *
 * The translation tables carry a plain copy of the value that was current
 * when the translation was written, so:
 *
 *     stale  ⇔  translation.source_hash IS DISTINCT FROM source.source_hash
 *
 * One SQL comparison, filterable and indexable, with no boolean to maintain.
 *
 * **md5, not sha256, and that is deliberate.** This is a change detector, not
 * a security primitive: its only job is to differ when the text differs, and
 * nobody gains anything by forging a collision with their own lesson. md5 is
 * also the only hash Postgres exposes as an IMMUTABLE function over `text` —
 * `sha256` takes `bytea`, and `convert_to` is merely STABLE (it depends on
 * the server encoding), so a sha256 expression cannot be used in a generated
 * column without wrapping it in a function that lies about its volatility.
 * A truthful md5 beats a sha256 with a false promise attached.
 *
 * The separator is the ASCII unit separator, so ("ab", "c") and ("a", "bc")
 * do not hash alike.
 */
const sourceHash = (expression: ReturnType<typeof sql>) =>
  text("source_hash").notNull().generatedAlwaysAs(expression);

/**
 * The workflow columns every `*_translations` table carries.
 *
 * Repeated across four tables rather than collapsed into one polymorphic
 * table with a `jsonb` payload — #15's original design. The repetition is of
 * COLUMNS, not of logic, and it buys real types: a wrong field name fails
 * `tsc` instead of returning `undefined` at runtime, and each table keeps its
 * own foreign key to the thing it translates.
 *
 * `on delete set null` on both people: an account being deleted must not take
 * the translation with it, and "translated by somebody who is gone" is a true
 * statement worth keeping.
 */
const translationWorkflow = {
  status: translationStatus("status").notNull().default("draft"),
  translatedBy: text("translated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedBy: text("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  /** The source fingerprint this translation was made from. See above. */
  sourceHash: text("source_hash").notNull(),
};

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

/**
 * A section body: an ordered array of typed blocks, defined and validated in
 * `lib/lessons/blocks.ts`.
 *
 * Blocks rather than the ProseMirror document this column used to hold, and
 * rather than an HTML string. The reasons are argued where the schema lives;
 * the one that decides it here is translation. `lesson_section_translations`
 * carries a per-locale body, and a block array lets a translation address a
 * block by its stable id — so images, video and layout stay shared, and a
 * structural edit to the English copy is detectable rather than a silent
 * desynchronisation of the Arabic.
 *
 * The editor still speaks ProseMirror; the bridge between the two is #20's
 * `toBlocks`/`fromBlocks` pair, not this column.
 */
export type LessonBody = LessonBlock[];

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

export const lessons = pgTable(
  "lessons",
  {
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
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * Cloudinary URL. Modelled here so the editor can carry it; the upload
     * widget belongs to the media issue and is not built yet, so today this is
     * a URL an editor pastes.
     */
    coverImageUrl: text("cover_image_url"),
    /** The fields a lesson_translations row is a translation OF. */
    sourceHash: sourceHash(sql`md5(title || E'\\x1f' || description)`),
    status: contentStatus("status").notNull().default("draft"),
    /**
     * Computed from the blocks when the lesson is saved — never per request,
     * and never in the browser. It is the same number for every reader, so
     * recomputing it on each render is work paid for by the reader, and two
     * clients computing it separately would disagree.
     */
    readingTimeSeconds: integer("reading_time_seconds").notNull().default(0),
    /**
     * Bumped whenever the body changes. Translation staleness is the point:
     * a translation row records the revision it was made from, so an Arabic
     * copy of a lesson whose English body has since moved on can be shown as
     * out of date rather than silently served as current.
     */
    revision: integer("revision").notNull().default(1),
    /**
     * Curriculum order. Lessons build on each other, so the catalogue is a
     * sequence, not an alphabet — ordering by slug put "acids-bases" before
     * "atomic-structure", which reads as a syllabus nobody wrote.
     */
    position: integer("position").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /**
     * Denormalised engagement counts, maintained by database TRIGGERS over
     * `lesson_likes`, `lesson_saves` and `share_events` — never by application
     * code.
     *
     * Denormalised because the catalogue renders every lesson as a card and
     * each card needs these: aggregate subqueries per card, on every visit, on
     * a serverless connection budget. Counts are read constantly and written
     * rarely, which is the case denormalisation is for.
     *
     * Triggers because `count = count + 1` in application code drifts the
     * moment a request dies between the two writes, and because deleting a
     * user cascades to their likes and saves without any application code
     * running at all — a trigger still fires, a service layer does not.
     * `scripts/reconcile-counters.ts` recomputes them and reports drift.
     *
     * `share_count` counts VERIFIED shares only. An outbound click is stored
     * and shown to admins as intent; counting it would make the number a lie.
     */
    likeCount: integer("like_count").notNull().default(0),
    /** Stored for the admin view. Never displayed publicly: a reading list is
     * private, and a public total would leak how many people saved a lesson
     * they have not endorsed. */
    saveCount: integer("save_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

    // Lessons are soft-deletable: they carry comments, likes and saves that a
    // hard delete would take with them.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("lessons_status_idx").on(t.status),
    index("lessons_position_idx").on(t.position),
  ],
);

export const lessonSections = pgTable(
  "lesson_sections",
  {
    id: id(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    body: jsonb("body").$type<LessonBody>().notNull(),
    /**
     * `body::text` is safe inside the hash: jsonb normalises on input — keys
     * sorted, whitespace dropped — so two equal jsonb values always render
     * the same text, and a reformatted-but-identical body does not read as a
     * change the translator has to redo.
     */
    sourceHash: sourceHash(sql`md5(heading || E'\\x1f' || body::text)`),
    ...timestamps,
  },
  (t) => [uniqueIndex("lesson_sections_order_idx").on(t.lessonId, t.position)],
);

// ── Quizzes ─────────────────────────────────────────────────────────────────

/**
 * Which sitting counts, when a quiz allows several. Declared here rather than
 * beside the attempts table because it is a property of the QUIZ — the rule an
 * author sets, not a state a sitting is in.
 */
export const attemptPolicy = pgEnum("attempt_policy", [
  "best",
  "latest",
  "average",
]);

/** When the candidate may see the answers. Also the author's decision. */
export const reviewPolicy = pgEnum("review_policy", [
  "immediate",
  "after_attempts_exhausted",
  "never",
]);

/**
 * How a question is answered.
 *
 * `true_false` is not a type: it is `single_choice` with two options, and
 * modelling it separately would mean two code paths that must agree forever.
 * `numeric` is deliberately absent — it needs tolerance-based grading, which
 * #26 puts out of scope.
 */
export const questionType = pgEnum("question_type", [
  "single_choice",
  "multiple_choice",
]);

export const quizzes = pgTable(
  "quizzes",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** The fields a quiz_translations row is a translation OF. */
    sourceHash: sourceHash(sql`md5(title || E'\\x1f' || description)`),
    difficulty: difficulty("difficulty").notNull(),
    category: text("category").notNull(),

    /**
     * Sitting rules. All nullable-or-defaulted, because an exam that has not
     * been configured should behave like the quizzes that exist today rather
     * than refuse to run.
     *
     * Null means "no limit" for both the timer and the attempt cap. Zero would
     * be a different claim — no time at all, no attempts allowed — and is the
     * kind of value a forgotten default quietly writes.
     */
    timeLimitSeconds: integer("time_limit_seconds"),
    /**
     * Latency and clock-skew allowance on every deadline check.
     *
     * An honest answer sent at T-1s must not be lost to a 400ms round trip.
     * A fixed server-side value per quiz, never something the client sends —
     * a client-supplied grace period is not a grace period.
     */
    graceSeconds: integer("grace_seconds").notNull().default(10),
    passMarkPercent: integer("pass_mark_percent").notNull().default(60),
    maxAttempts: integer("max_attempts"),
    /** Enforced wait between sittings. 0 means straight back in. */
    cooldownMinutes: integer("cooldown_minutes").notNull().default(0),
    attemptPolicy: attemptPolicy("attempt_policy").notNull().default("best"),
    reviewPolicy: reviewPolicy("review_policy").notNull().default("immediate"),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    shuffleOptions: boolean("shuffle_options").notNull().default(false),

    status: contentStatus("status").notNull().default("draft"),
    position: integer("position").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Soft-deletable for the same reason lessons are: attempts and results
    // will reference these rows, and a hard delete would take a student's
    // history with it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("quizzes_status_idx").on(t.status),
    index("quizzes_position_idx").on(t.position),
  ],
);

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
    type: questionType("type").notNull().default("single_choice"),
    prompt: text("prompt").notNull(),
    /**
     * The fields a quiz_question_translations row is a translation OF.
     *
     * The options are not in it. They live in `quiz_options` and have no
     * translation table yet, so including them would mark every translation
     * stale for a change no translator can act on. When options become
     * translatable this hash grows to cover them.
     */
    sourceHash: sourceHash(sql`md5(prompt || E'\\x1f' || explanation)`),
    /**
     * Never sent to a browser before the attempt is submitted. The in-progress
     * query names its columns explicitly so this one cannot be included by
     * forgetting to exclude it.
     */
    explanation: text("explanation").notNull(),
    /**
     * The single-choice answer. Kept as the FK it always should have been.
     *
     * Multiple choice cannot express its answer here, so it uses
     * `quiz_options.is_correct` instead; a check constraint keeps the two from
     * disagreeing. Single-choice rows are mirrored into `is_correct` by the
     * migration and by the admin action, so scoring reads one column for both
     * types rather than branching on the question's type to find its answer.
     */
    correctOptionId: uuid("correct_option_id"),
    /** Multiple choice only: whether a partly-right answer earns part marks. */
    partialCredit: boolean("partial_credit").notNull().default(false),
    /**
     * What this question is worth. Defaults to 1, so a scoring pass that
     * ignores it still counts questions — which is what the quiz page does
     * today.
     */
    points: integer("points").notNull().default(1),
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
    /**
     * The answer, for both question types.
     *
     * NEVER selected by the in-progress query — that query lists its columns
     * explicitly, so shipping the answer key requires adding this column by
     * name rather than merely forgetting to remove it.
     */
    isCorrect: boolean("is_correct").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("quiz_options_order_idx").on(t.questionId, t.position)],
);

// ── Pages ───────────────────────────────────────────────────────────────────

/**
 * The open/close switch for public routes.
 *
 * Keyed by the ROUTE PATTERN rather than by an id: the thing being switched is
 * a URL, the proxy has only a URL to match on, and a surrogate key would mean
 * a lookup before the decision could be made. It is also what makes the
 * reconciliation check possible — a route in `app/` either has a row here or it
 * does not.
 *
 * Which routes may appear here is decided in `lib/pages/routes.ts`, not by
 * whatever happens to be under `app/`. Admin and auth routes are excluded on
 * purpose: closing them closes the page that reopens them.
 */
export const pages = pgTable("pages", {
  routeKey: text("route_key").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  /**
   * Localised, as `{ en, ar }`. jsonb rather than a side-car table because it
   * is one short string per locale with no independent publish state — the
   * trade-off documented for content translations does not apply.
   */
  maintenanceMessage: jsonb("maintenance_message").$type<
    Record<string, string>
  >(),
  /** Whether the route appears in the public nav while it is open. */
  showInNav: boolean("show_in_nav").notNull().default(true),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledBy: uuid("disabled_by"),
  ...timestamps,
});

// ── Translations ────────────────────────────────────────────────────────────

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
    ...translationWorkflow,
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
    body: jsonb("body").$type<LessonBody>().notNull(),
    ...translationWorkflow,
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
    ...translationWorkflow,
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
    ...translationWorkflow,
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
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type ContentStatus = (typeof contentStatus.enumValues)[number];
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
