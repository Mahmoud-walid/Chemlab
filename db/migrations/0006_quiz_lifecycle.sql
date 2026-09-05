ALTER TABLE "quiz_questions" ADD COLUMN "points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "time_limit_seconds" integer;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "pass_mark_percent" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "max_attempts" integer;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "shuffle_questions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "shuffle_options" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "status" "content_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "quizzes_status_idx" ON "quizzes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quizzes_position_idx" ON "quizzes" USING btree ("position");--> statement-breakpoint
-- Backfill, and the reason this migration is not left as generated.
--
-- `status` defaults to 'draft'. Quizzes had no status column at all, so every
-- one of the six is live today; applying the generated DDL alone would take
-- them all off the public site the moment it ran. Unlike lessons there is no
-- older column to derive the answer from — "it existed" IS the old rule.
UPDATE "quizzes"
SET "status" = 'published',
    "published_at" = now()
WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- Slug order, in tens, so a quiz can be moved between two others without
-- renumbering the rest. Preserves exactly the sequence the catalogue shows
-- today, which ordered by slug.
WITH ordered AS (
  SELECT "id", (row_number() OVER (ORDER BY "slug"))::int * 10 AS "pos"
  FROM "quizzes"
)
UPDATE "quizzes"
SET "position" = ordered."pos"
FROM ordered
WHERE "quizzes"."id" = ordered."id";
