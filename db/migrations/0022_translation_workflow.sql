-- Translation workflow: status, ownership and staleness.
--
-- `source_hash` on the SOURCE tables is GENERATED ALWAYS ... STORED, so
-- Postgres recomputes it in the same statement that edits the source. That is
-- what makes "editing the English copy marks its Arabic translation stale"
-- atomic without any write path remembering to do it: staleness is the
-- comparison `translation.source_hash IS DISTINCT FROM source.source_hash`,
-- never a stored flag that can fall out of step.
--
-- md5 rather than sha256 because it is the only hash Postgres exposes as an
-- IMMUTABLE function over `text`, which a generated column requires. It is a
-- change detector, not a security primitive. See db/schema/content.ts.
--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('draft', 'in_review', 'published');
--> statement-breakpoint
ALTER TABLE "lesson_sections" ADD COLUMN "source_hash" text GENERATED ALWAYS AS (md5(heading || E'\x1f' || body::text)) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "source_hash" text GENERATED ALWAYS AS (md5(title || E'\x1f' || description)) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "source_hash" text GENERATED ALWAYS AS (md5(prompt || E'\x1f' || explanation)) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "source_hash" text GENERATED ALWAYS AS (md5(title || E'\x1f' || description)) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD COLUMN "status" "translation_status" DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD COLUMN "translated_by" text;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD COLUMN "status" "translation_status" DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD COLUMN "translated_by" text;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD COLUMN "status" "translation_status" DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD COLUMN "translated_by" text;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD COLUMN "status" "translation_status" DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD COLUMN "translated_by" text;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
-- Nullable first. These tables have rows, and a NOT NULL column with no
-- default cannot be added to a table that is not empty. The backfill below
-- gives every existing translation the hash of the source as it stands, which
-- is the only honest starting point: nothing recorded what those translations
-- were made from, so the alternative is marking the entire Arabic catalogue
-- stale on deploy for changes nobody made.
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD COLUMN "source_hash" text;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD COLUMN "source_hash" text;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD COLUMN "source_hash" text;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD COLUMN "source_hash" text;
--> statement-breakpoint
-- And `published`, not the column default of `draft`: these rows are live
-- today. Landing them as drafts would retroactively unpublish translations
-- that readers are already being served.
--> statement-breakpoint
UPDATE "lesson_translations" AS t SET "source_hash" = s."source_hash", "status" = 'published' FROM "lessons" AS s WHERE s."id" = t."lesson_id";
--> statement-breakpoint
UPDATE "lesson_section_translations" AS t SET "source_hash" = s."source_hash", "status" = 'published' FROM "lesson_sections" AS s WHERE s."id" = t."section_id";
--> statement-breakpoint
UPDATE "quiz_translations" AS t SET "source_hash" = s."source_hash", "status" = 'published' FROM "quizzes" AS s WHERE s."id" = t."quiz_id";
--> statement-breakpoint
UPDATE "quiz_question_translations" AS t SET "source_hash" = s."source_hash", "status" = 'published' FROM "quiz_questions" AS s WHERE s."id" = t."question_id";
--> statement-breakpoint
ALTER TABLE "lesson_translations" ALTER COLUMN "source_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ALTER COLUMN "source_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ALTER COLUMN "source_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ALTER COLUMN "source_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD CONSTRAINT "lesson_section_translations_translated_by_users_id_fk" FOREIGN KEY ("translated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lesson_section_translations" ADD CONSTRAINT "lesson_section_translations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD CONSTRAINT "lesson_translations_translated_by_users_id_fk" FOREIGN KEY ("translated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lesson_translations" ADD CONSTRAINT "lesson_translations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD CONSTRAINT "quiz_question_translations_translated_by_users_id_fk" FOREIGN KEY ("translated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_question_translations" ADD CONSTRAINT "quiz_question_translations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD CONSTRAINT "quiz_translations_translated_by_users_id_fk" FOREIGN KEY ("translated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_translations" ADD CONSTRAINT "quiz_translations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
