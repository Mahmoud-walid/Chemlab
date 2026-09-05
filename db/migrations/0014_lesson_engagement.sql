CREATE TYPE "public"."share_channel" AS ENUM('web_share', 'clipboard', 'outbound_link');--> statement-breakpoint
CREATE TABLE "lesson_likes" (
	"lesson_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_likes_lesson_id_user_id_pk" PRIMARY KEY("lesson_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_saves" (
	"lesson_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_saves_lesson_id_user_id_pk" PRIMARY KEY("lesson_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "share_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" text,
	"channel" "share_channel" NOT NULL,
	"verified" boolean NOT NULL,
	"target" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "save_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "share_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_likes" ADD CONSTRAINT "lesson_likes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_likes" ADD CONSTRAINT "lesson_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_saves" ADD CONSTRAINT "lesson_saves_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_saves" ADD CONSTRAINT "lesson_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_events" ADD CONSTRAINT "share_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_events" ADD CONSTRAINT "share_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_likes_user_idx" ON "lesson_likes" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lesson_saves_user_idx" ON "lesson_saves" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "share_events_lesson_idx" ON "share_events" USING btree ("lesson_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "share_events_dedupe_idx" ON "share_events" USING btree ("lesson_id","user_id","channel",date_trunc('hour', created_at at time zone 'UTC')) WHERE user_id is not null and verified;--> statement-breakpoint
-- ── Counters, maintained by the database ────────────────────────────────────
--
-- `lessons.like_count` and friends are denormalised because the catalogue
-- renders every lesson as a card and each card needs them: aggregate
-- subqueries per card, on every visit. Counts are read constantly and written
-- rarely, which is the case denormalisation exists for.
--
-- Maintained by TRIGGERS rather than by application code, for two reasons that
-- are not stylistic:
--
-- 1. A trigger fires in the SAME TRANSACTION as the row it counts. An
--    application doing `insert` then `update ... count + 1` drifts the moment
--    a request dies between the two, and nothing detects it until someone
--    counts by hand.
-- 2. `on delete cascade` removes a departing user's likes and saves without
--    running a single line of application code. A service layer cannot
--    decrement what it never sees; a trigger fires anyway.
--
-- The cost, accepted: this logic lives in SQL, invisible to the type system,
-- so it is tested at the database level and `pnpm reconcile` recomputes every
-- counter from source and reports drift.

CREATE OR REPLACE FUNCTION lesson_like_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "lessons" SET "like_count" = "like_count" + 1
    WHERE "id" = NEW."lesson_id";
  ELSIF TG_OP = 'DELETE' THEN
    -- `greatest(..., 0)`: a counter that has somehow drifted below zero should
    -- stop at zero rather than render "-1 likes" while somebody investigates.
    UPDATE "lessons" SET "like_count" = greatest("like_count" - 1, 0)
    WHERE "id" = OLD."lesson_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION lesson_save_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "lessons" SET "save_count" = "save_count" + 1
    WHERE "id" = NEW."lesson_id";
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "lessons" SET "save_count" = greatest("save_count" - 1, 0)
    WHERE "id" = OLD."lesson_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Only VERIFIED shares move the public count. An outbound click is stored and
-- shown to admins as intent — `window.open` to an intent URL says the user
-- left, it cannot say they pressed Post — and counting it would make the
-- number a lie.
CREATE OR REPLACE FUNCTION lesson_share_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."verified" THEN
    UPDATE "lessons" SET "share_count" = "share_count" + 1
    WHERE "id" = NEW."lesson_id";
  ELSIF TG_OP = 'DELETE' AND OLD."verified" THEN
    UPDATE "lessons" SET "share_count" = greatest("share_count" - 1, 0)
    WHERE "id" = OLD."lesson_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER lesson_likes_count_trg
AFTER INSERT OR DELETE ON "lesson_likes"
FOR EACH ROW EXECUTE FUNCTION lesson_like_count();--> statement-breakpoint

CREATE TRIGGER lesson_saves_count_trg
AFTER INSERT OR DELETE ON "lesson_saves"
FOR EACH ROW EXECUTE FUNCTION lesson_save_count();--> statement-breakpoint

CREATE TRIGGER share_events_count_trg
AFTER INSERT OR DELETE ON "share_events"
FOR EACH ROW EXECUTE FUNCTION lesson_share_count();--> statement-breakpoint

-- Backfill, so the counters are correct from the moment they exist rather than
-- from the first write after this migration. No-ops on a fresh database and
-- correct on one that somehow already has rows.
UPDATE "lessons" l SET
  "like_count" = (SELECT count(*) FROM "lesson_likes" WHERE "lesson_id" = l."id"),
  "save_count" = (SELECT count(*) FROM "lesson_saves" WHERE "lesson_id" = l."id"),
  "share_count" = (SELECT count(*) FROM "share_events" WHERE "lesson_id" = l."id" AND "verified");
