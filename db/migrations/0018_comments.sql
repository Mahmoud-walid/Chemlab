CREATE TYPE "public"."comment_status" AS ENUM('visible', 'hidden', 'flagged', 'removed');--> statement-breakpoint
CREATE TYPE "public"."comment_subject" AS ENUM('lesson');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('like', 'dislike');--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"comment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" "reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "comment_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"parent_id" uuid,
	"root_id" uuid,
	"path" text NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'visible' NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"dislike_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_depth_cap" CHECK (depth <= 1),
	CONSTRAINT "comments_threading_coherent" CHECK ((depth = 0 and parent_id is null and root_id is null) or (depth = 1 and parent_id is not null and root_id is not null))
);
--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_root_id_comments_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("comment_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reports_unique_idx" ON "comment_reports" USING btree ("comment_id","reporter_id");--> statement-breakpoint
CREATE INDEX "comment_reports_open_idx" ON "comment_reports" USING btree ("created_at") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "comments_feed_idx" ON "comments" USING btree ("subject_type","subject_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE depth = 0 and status in ('visible', 'flagged');--> statement-breakpoint
CREATE INDEX "comments_replies_idx" ON "comments" USING btree ("parent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_top_idx" ON "comments" USING btree ("subject_type","subject_id",(like_count - dislike_count) desc,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Counters are maintained by TRIGGERS, never by application code.
--
-- The same rule as the lesson counters in 0014, for the same reasons:
--
-- 1. A trigger fires in the SAME TRANSACTION as the row it counts, so a
--    request that dies between the insert and the increment cannot leave a
--    count that is wrong for ever.
-- 2. `ON DELETE CASCADE` removes a departing user's reactions without running
--    any application code at all. Nothing in a service layer can decrement
--    what it never sees; a trigger fires anyway.
--
-- `pnpm reconcile` recomputes every counter from source and exits non-zero on
-- drift, so a dropped trigger is a failed CI run rather than numbers that look
-- fine and are wrong.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION comment_reaction_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET
      like_count = like_count + (NEW.type = 'like')::int,
      dislike_count = dislike_count + (NEW.type = 'dislike')::int
    WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET
      like_count = greatest(0, like_count - (OLD.type = 'like')::int),
      dislike_count = greatest(0, dislike_count - (OLD.type = 'dislike')::int)
    WHERE id = OLD.comment_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.type IS DISTINCT FROM NEW.type THEN
    -- Switching sides: one row moved, so both counters move by one. This is
    -- the case that a delete-plus-insert model gets wrong under two clicks.
    UPDATE comments SET
      like_count = greatest(0, like_count + (NEW.type = 'like')::int - (OLD.type = 'like')::int),
      dislike_count = greatest(0, dislike_count + (NEW.type = 'dislike')::int - (OLD.type = 'dislike')::int)
    WHERE id = NEW.comment_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER comment_reactions_count
AFTER INSERT OR UPDATE OR DELETE ON comment_reactions
FOR EACH ROW EXECUTE FUNCTION comment_reaction_counts();--> statement-breakpoint

-- Reply counts, and the lesson's own comment count.
--
-- `comment_count` counts what a reader can SEE — visible and flagged roots and
-- replies — so moderating a comment moves the number the page shows. A count
-- that included hidden rows would advertise comments nobody can read.
CREATE OR REPLACE FUNCTION comment_counts() RETURNS trigger AS $$
DECLARE
  visible_before boolean;
  visible_after boolean;
BEGIN
  visible_before := TG_OP <> 'INSERT'
    AND OLD.status IN ('visible', 'flagged') AND OLD.deleted_at IS NULL;
  visible_after := TG_OP <> 'DELETE'
    AND NEW.status IN ('visible', 'flagged') AND NEW.deleted_at IS NULL;

  IF visible_after AND NOT visible_before THEN
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
    END IF;
    IF NEW.subject_type = 'lesson' THEN
      UPDATE lessons SET comment_count = comment_count + 1 WHERE id = NEW.subject_id;
    END IF;
  ELSIF visible_before AND NOT visible_after THEN
    IF OLD.parent_id IS NOT NULL THEN
      UPDATE comments SET reply_count = greatest(0, reply_count - 1) WHERE id = OLD.parent_id;
    END IF;
    IF OLD.subject_type = 'lesson' THEN
      UPDATE lessons SET comment_count = greatest(0, comment_count - 1) WHERE id = OLD.subject_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER comments_count
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION comment_counts();
