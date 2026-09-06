-- Two resolved decisions from docs/DEFERRED_QUESTIONS.md.
--
-- ── Q39: presence is opt-in ─────────────────────────────────────────────────
-- The default becomes `nobody` on a site whose own metadata says it is for
-- kids. An always-public presence signal tells anyone watching when a
-- particular student is at their desk and when they stop; the cost of being
-- wrong this way is a missing green dot, and the other way it is a log of a
-- child's daily routine.
--
-- Existing rows are moved too, and that is the part worth arguing. The column
-- does not record whether a value was CHOSEN or merely defaulted, so a
-- backfill cannot spare somebody who deliberately said `everyone`. It is done
-- anyway because presence shipped days ago and nobody has been offered the
-- choice yet: every current row holds a default nobody selected. Making the
-- default opt-in while leaving every existing account broadcasting would be
-- the decision in name only.
ALTER TABLE "users" ALTER COLUMN "presence_visibility" SET DEFAULT 'nobody';--> statement-breakpoint

UPDATE "users" SET "presence_visibility" = 'nobody'
  WHERE "presence_visibility" = 'everyone';--> statement-breakpoint

-- ── Q40: deleting an account that has audited something ─────────────────────
-- `audit_log.actor_id` is `ON DELETE SET NULL`, and the append-only trigger
-- refused every UPDATE — so deleting such a user attempted an update the
-- trigger forbade, and the delete failed with a message about the audit log
-- from a screen about a user. Both rules were wanted; together they were a
-- contradiction.
--
-- Resolved by keeping the log immutable and widening the trigger by exactly
-- one case: `actor_id` may go from a value to NULL, provided EVERY other
-- column is untouched. The trigger exists so the log cannot be rewritten, and
-- nulling the author of an entry does not rewrite what the entry says.
--
-- The narrowness is the whole point, and it is enforced by comparison rather
-- than by trust: OLD is copied, its `actor_id` nulled, and the result must be
-- indistinguishable from NEW. So this permits anonymising an actor and
-- nothing else — not re-pointing `actor_id` at a different user, not changing
-- `action` in the same statement, not a second edit once it is already NULL.
CREATE OR REPLACE FUNCTION assert_audit_log_append_only() RETURNS trigger AS $$
DECLARE
  anonymised audit_log%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.actor_id IS NOT NULL
     AND NEW.actor_id IS NULL
  THEN
    anonymised := OLD;
    anonymised.actor_id := NULL;

    -- Every other column identical, or it is not an anonymisation.
    IF NEW IS NOT DISTINCT FROM anonymised THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
