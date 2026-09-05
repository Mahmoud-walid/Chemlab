CREATE TYPE "public"."attempt_policy" AS ENUM('best', 'latest', 'average');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('single_choice', 'multiple_choice');--> statement-breakpoint
CREATE TYPE "public"."review_policy" AS ENUM('immediate', 'after_attempts_exhausted', 'never');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted', 'expired', 'abandoned', 'voided');--> statement-breakpoint
CREATE TABLE "attempt_answers" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_correct" boolean,
	"points_awarded" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"time_spent_ms" integer,
	CONSTRAINT "attempt_answers_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quiz_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"seed" integer NOT NULL,
	"quiz_revision" timestamp with time zone NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"score" integer,
	"max_score" integer,
	"passed" boolean,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Drift from 0009, where this column was made nullable by hand after the file
-- was generated: a cleared optional setting is a null value, which is a
-- different fact from no row at all. A no-op against any database that ran
-- 0009; it exists so the snapshot and reality stop disagreeing.
ALTER TABLE "settings" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_options" ADD COLUMN "is_correct" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "type" "question_type" DEFAULT 'single_choice' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "partial_credit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "grace_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "cooldown_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "attempt_policy" "attempt_policy" DEFAULT 'best' NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "review_policy" "review_policy" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_number_idx" ON "exam_attempts" USING btree ("quiz_id","user_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_one_live_idx" ON "exam_attempts" USING btree ("quiz_id","user_id") WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX "exam_attempts_user_idx" ON "exam_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "exam_attempts_quiz_idx" ON "exam_attempts" USING btree ("quiz_id","status");
--> statement-breakpoint
-- ── Backfill the answer key ────────────────────────────────────────────────
--
-- `quiz_options.is_correct` is the column scoring reads, for both question
-- types. Every question that exists today is single-choice and records its
-- answer in `quiz_questions.correct_option_id`, so without this backfill the
-- new column is false everywhere and every candidate scores zero — a
-- generated DDL-only migration would ship exactly that.
UPDATE "quiz_options" AS o
SET "is_correct" = true
FROM "quiz_questions" AS q
WHERE q."correct_option_id" = o."id";--> statement-breakpoint

-- ── Keep the two representations from diverging ────────────────────────────
--
-- Two columns can express the same fact, so one of them will eventually be
-- wrong. `correct_option_id` is what the admin editor writes and what the
-- foreign key protects; `is_correct` is what scoring reads. A trigger makes
-- the second follow the first for single-choice questions, whatever code path
-- did the writing — an application-level convention would hold only until
-- somebody writes the row from a script.
--
-- Multiple-choice questions are left alone: their answer cannot be expressed
-- as one id, so `is_correct` is authoritative there and `correct_option_id`
-- stays null.
CREATE OR REPLACE FUNCTION sync_single_choice_answer() RETURNS trigger AS $$
BEGIN
  IF NEW."correct_option_id" IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE "quiz_options"
  SET "is_correct" = ("id" = NEW."correct_option_id")
  WHERE "question_id" = NEW."id"
    AND "is_correct" IS DISTINCT FROM ("id" = NEW."correct_option_id");

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER quiz_questions_sync_answer
AFTER INSERT OR UPDATE OF "correct_option_id" ON "quiz_questions"
FOR EACH ROW EXECUTE FUNCTION sync_single_choice_answer();--> statement-breakpoint

-- ── One live attempt, and the sweep that makes it survivable ───────────────
--
-- `exam_attempts_one_live_idx` above is what stops two tabs starting two
-- sittings; a `select count(*)` before insert loses that race. The cost is
-- that an attempt left in_progress by a closed laptop would block every
-- future sitting forever, which is why the expiry sweep exists in
-- `db/queries/exams/attempts.ts` rather than being optional.
COMMENT ON INDEX "exam_attempts_one_live_idx" IS
  'At most one in_progress attempt per user per quiz. Requires the expiry sweep to release abandoned attempts.';
