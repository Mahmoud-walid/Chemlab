CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "status" "content_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "lessons_status_idx" ON "lessons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lessons_position_idx" ON "lessons" USING btree ("position");--> statement-breakpoint
-- Backfill, and the reason this migration is not left as generated.
--
-- `status` defaults to 'draft', so applying the generated DDL alone would take
-- all thirteen published lessons off the public site the moment it ran — the
-- new column would say draft while `published_at` still said otherwise. The
-- old rule ("published_at IS NOT NULL means live") is therefore carried into
-- the new column here, in the same migration, rather than in a follow-up
-- nobody would remember to run.
UPDATE "lessons"
SET "status" = 'published'
WHERE "published_at" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint

-- Soft-deleted lessons become archived rather than draft: they were live once,
-- and "draft" would invite an editor to publish something that was withdrawn.
UPDATE "lessons"
SET "status" = 'archived'
WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint

-- `position` defaults to 0, which would make the curriculum order arbitrary
-- (Postgres would return the ties in physical row order). Seeding it from the
-- slug order preserves exactly the sequence the catalogue shows today, and
-- gives the editor distinct values to reorder.
WITH ordered AS (
  SELECT "id", (row_number() OVER (ORDER BY "slug"))::int * 10 AS "pos"
  FROM "lessons"
)
UPDATE "lessons"
SET "position" = ordered."pos"
FROM ordered
WHERE "lessons"."id" = ordered."id";
