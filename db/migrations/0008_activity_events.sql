CREATE TYPE "public"."activity_object_type" AS ENUM('user', 'lesson', 'quiz', 'element', 'page', 'comment', 'attempt', 'role', 'setting', 'export');--> statement-breakpoint
CREATE TYPE "public"."activity_verb" AS ENUM('auth.signed_in', 'auth.signed_up', 'auth.signed_out', 'lesson.viewed', 'lesson.completed', 'lesson.liked', 'lesson.unliked', 'lesson.saved', 'lesson.shared', 'comment.posted', 'comment.liked', 'comment.deleted', 'exam.started', 'exam.submitted', 'exam.abandoned', 'admin.created', 'admin.updated', 'admin.deleted', 'admin.published', 'admin.page_toggled', 'admin.settings_changed', 'admin.exported');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text,
	"verb" "activity_verb" NOT NULL,
	"object_type" "activity_object_type",
	"object_id" text,
	"metadata" jsonb,
	"session_id" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_actor_idx" ON "activity_events" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_verb_idx" ON "activity_events" USING btree ("verb","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_object_idx" ON "activity_events" USING btree ("object_type","object_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- Immutable, but redactable — and those are different things.
--
-- `audit_log` refuses UPDATE *and* DELETE: it is a security record and nothing
-- may remove it. `activity_events` is analytics with a retention policy, so
-- DELETE has to stay possible or the 180-day purge could never run.
--
-- UPDATE is refused, with one exception that is not a loophole but the whole
-- privacy design. Two things legitimately erase parts of a stored event:
--
--   * deleting an account, which nulls `actor_id` via ON DELETE SET NULL —
--     itself an UPDATE, so a blanket refusal makes deleting a user impossible;
--   * the 90-day purge, which nulls `ip_address` and `user_agent`.
--
-- Both only ever REMOVE information, from those three columns, and never
-- restore it. So the rule is: a column may go from a value to NULL, and
-- nothing else may change. Rewriting a verb, re-pointing an object, moving a
-- timestamp or putting an actor back are all refused — an event is a statement
-- about something that happened, and editing one is not a correction.
CREATE OR REPLACE FUNCTION assert_activity_events_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.verb            IS DISTINCT FROM OLD.verb
  OR NEW.object_type     IS DISTINCT FROM OLD.object_type
  OR NEW.object_id       IS DISTINCT FROM OLD.object_id
  OR NEW.metadata        IS DISTINCT FROM OLD.metadata
  OR NEW.session_id      IS DISTINCT FROM OLD.session_id
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  OR NEW.id              IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'activity_events is immutable: only redaction is permitted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The three redactable columns may only be emptied, never rewritten.
  IF (NEW.actor_id   IS NOT NULL AND NEW.actor_id   IS DISTINCT FROM OLD.actor_id)
  OR (NEW.ip_address IS NOT NULL AND NEW.ip_address IS DISTINCT FROM OLD.ip_address)
  OR (NEW.user_agent IS NOT NULL AND NEW.user_agent IS DISTINCT FROM OLD.user_agent)
  THEN
    RAISE EXCEPTION 'activity_events is immutable: a redacted column may only be set to NULL'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER activity_events_immutable
  BEFORE UPDATE ON "activity_events"
  FOR EACH ROW EXECUTE FUNCTION assert_activity_events_immutable();
