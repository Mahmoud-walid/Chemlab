-- Authorization guarantees that no application bug, script, or psql session
-- can undo. The service layer checks these too, and gives better messages —
-- but the service layer is the part that can have a bug in it.

-- ── There must always be at least one Super Admin ───────────────────────────
-- Runs on DELETE and on UPDATE (re-pointing a row at another role is a
-- revocation wearing a disguise). Deleting the user cascades into user_roles
-- and therefore into this trigger too, so the last Super Admin cannot be
-- removed by deleting their account either.
CREATE OR REPLACE FUNCTION assert_super_admin_remains() RETURNS trigger AS $$
DECLARE
  remaining int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM roles r
     WHERE r.id = OLD.role_id AND r.key = 'super_admin'
  ) THEN
    SELECT count(*) INTO remaining
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
     WHERE r.key = 'super_admin'
       AND ur.user_id <> OLD.user_id;

    IF remaining = 0 THEN
      RAISE EXCEPTION 'the last super_admin cannot be removed'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER user_roles_protect_last_super_admin
  BEFORE DELETE OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION assert_super_admin_remains();
--> statement-breakpoint

-- ── Protected roles cannot be deleted; system roles cannot be re-keyed ──────
-- The display name and description stay editable: freezing those would make
-- the roles table feel broken for no security gain. The KEY is what code and
-- the super-admin short-circuit match on, so that is what is frozen.
CREATE OR REPLACE FUNCTION assert_role_protection() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_protected THEN
      RAISE EXCEPTION 'role "%" is protected and cannot be deleted', OLD.key
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'system role "%" cannot be re-keyed', OLD.key
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Clearing the flags would be a way to delete a protected role in two steps.
  IF OLD.is_protected AND NOT NEW.is_protected THEN
    RAISE EXCEPTION 'role "%" cannot have its protection removed', OLD.key
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.is_system AND NOT NEW.is_system THEN
    RAISE EXCEPTION 'role "%" cannot stop being a system role', OLD.key
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER roles_protect_system
  BEFORE DELETE OR UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION assert_role_protection();
--> statement-breakpoint

-- ── The audit log is append-only ────────────────────────────────────────────
-- An audit log the application can rewrite records only what an attacker was
-- willing to leave behind.
CREATE OR REPLACE FUNCTION assert_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION assert_audit_log_append_only();
