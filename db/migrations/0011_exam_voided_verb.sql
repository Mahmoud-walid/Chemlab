-- `activity_events.verb` is a Postgres enum, not text — deliberately, so a
-- mistyped verb is rejected by the database rather than silently creating a
-- category nothing will ever query. The cost is that adding a verb to
-- `lib/activity/verbs.ts` is only half the change: without this, recording
-- `exam.voided` fails at runtime and the void still succeeds, leaving the
-- action's audit trail with a hole in it.
ALTER TYPE "public"."activity_verb" ADD VALUE 'exam.voided' BEFORE 'admin.created';