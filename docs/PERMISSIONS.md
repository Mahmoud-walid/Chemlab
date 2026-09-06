# Permissions and roles

Authorization in Chemlab is **data, not constants**. The Super Admin has to be
able to define roles and permissions at runtime, which rules out a
`role: "admin" | "user"` enum or a hard-coded `PERMISSIONS` object — under
those, every new role is a pull request.

The code knows how to _check_ a permission. The database knows which
permissions exist and who holds them.

## The vocabulary

Names are `resource:action`, lowercase, singular resource, colon separator.
`resource` and `action` are stored as separate columns with `name` as the
unique key, so the admin UI can group by resource without parsing strings.

**Resources:** `admin`, `lesson`, `element`, `quiz`, `exam`, `comment`, `page`,
`user`, `role`, `permission`, `setting`, `media`, `notification`, `audit`,
`activity`, `translation`.

**Actions:** `read`, `create`, `update`, `delete`, `publish`, `moderate`,
`assign`, `impersonate`, `export`, `toggle`, `bypass`, `access`, `read_pii`,
`update_security`, `void`, `write`, `review`, `delete_hard`.

`lesson:delete_hard` and `quiz:delete_hard` are separate from their `delete`
counterparts for the same reason `setting:update_security` is separate from
`setting:update`: soft delete keeps the row and can be undone, and erasing one
cannot. **No role holds either by default, including Admin.** They exist for a
row created by mistake — something somebody made while learning the editor —
and the refusals are their definition rather than a safety net: a row that is
published, was ever published, or that anything else refers to is history, and
history gets withdrawn instead. A Super Admin can grant them at runtime when
somebody genuinely needs it.

What counts as a reference differs by resource, and the difference is
structural rather than a choice. A lesson is blocked by a comment, a save, a
like or an activity event; a quiz is blocked by an ATTEMPT or an activity
event, and cannot be blocked by a comment or a save at all — `comment_subject`
is an enum whose only value is `lesson`, and every engagement table holds a
`lesson_id`. Erasing a quiz removes a subtree: its questions, its options and
its translations all cascade, which is why the audit entry records how many
questions went with it.

`translation` is a resource of its own rather than actions on `lesson` and
`quiz`, because a translator works across every content type and must not
thereby gain the right to edit the English originals — which `lesson:update`
would give them. Its `write` is deliberately one grant rather than `create`
plus `update`: starting a translation and finishing it are the same job.
`review` is separate from both, because checking a chemistry translation is a
language competence rather than a publishing right, and a mistranslated
definition is a factual error. The `editor` role holds `translation:write` but
not `translation:review` — self-approval is how an unchecked translation
reaches a reader looking exactly like a checked one.

Two actions narrow another one rather than naming a new verb:
`activity:read_pii` sits inside `activity:read` (the stream without IP
addresses and user agents is still the stream), and `setting:update_security`
sits inside `setting:update` (session lifetime, the rate limits and the sign-in
provider list decide who gets in; renaming the site does not). Both are
separate permissions because the narrower half is a different decision to
trust somebody with — and both are two-part names, so the vocabulary stays
`resource:action` instead of growing a third segment.

`exam:void` is a third of the same shape. Reading the scores and striking one
out are different levels of trust: a void changes somebody's record, is
visible to them, and cannot be undone by the person who did it.

Not every pairing is meaningful, so `db/seed/rbac.ts` lists the permissions
explicitly rather than seeding a cross product — a cross product would create
`audit:publish` and `element:moderate`, which nothing will ever check.

`admin:access` is the odd one out: it is the gate on the panel itself and
grants no data access on its own.

### Why a fixed vocabulary at all, if permissions are rows?

Because a free-form string is a trap. `lesson:publsh` creates a permission that
protects nothing and looks exactly like one that works. So:

- the vocabulary lives in `db/seed/rbac.ts` and is seeded on every deploy;
- `requirePermission("lesson:publsh")` **throws** `UnknownPermissionError`
  rather than denying. Denying would be the dangerous behaviour — it looks
  identical to a guard that works, and stays invisible until someone removes
  the "broken" check and finds it was the only thing standing there;
- adding a genuinely new permission is a seed row plus a line here. That is the
  point: it is not a migration.

## Starting roles

| Role        | Key           | What it is                                                          |
| ----------- | ------------- | ------------------------------------------------------------------- |
| Super Admin | `super_admin` | Everything, implicitly. Protected and undeletable.                  |
| Admin       | `admin`       | Runs the platform day to day; cannot redefine authorization itself. |
| Editor      | `editor`      | Writes and publishes content. No users, roles or settings.          |
| Moderator   | `moderator`   | Comments and the people who wrote them, nothing else.               |
| Member      | `member`      | Every signed-up visitor. No admin permissions.                      |

A user may hold several roles; their effective permissions are the **union**.

There are no deny rules. "Editor, except cannot delete" is a narrower role, not
an exception — deny rules make effective permissions impossible to reason about
and impossible to display honestly in an admin UI.

`member` is assigned on signup so that "authenticated but unprivileged" is a
real, inspectable state rather than an absence of rows, which is
indistinguishable from a failed assignment.

## The Super Admin

Its power is a **short-circuit in code**, not `role_permissions` rows. The role
holds zero grant rows on purpose: a Super Admin who could be silently defanged
by deleting a join row is not a Super Admin.

Three things the database itself refuses, via triggers in
`db/migrations/0004_rbac_guards.sql`:

1. **Removing the last holder.** On `DELETE` and on `UPDATE` — re-pointing the
   row at another role is a revocation in disguise. Deleting the _user_
   cascades into `user_roles` and hits the same trigger, so that route is
   closed too.
2. **Deleting or re-keying the role**, or clearing its `is_protected` flag —
   otherwise "unprotect, then delete" is a two-step bypass. The display name
   stays editable: code matches on the key.
3. **Editing the audit log.** `UPDATE` and `DELETE` both raise.

The service layer checks these too and gives friendlier errors. The triggers
are the ones that hold when the service layer has a bug in it.

## Bootstrapping the first Super Admin

Granting a role requires `role:assign`, which requires being a Super Admin, and
at the start nobody is. So the first grant happens at deployment time:

```bash
# 1. sign up normally at /sign-up with the owner's address
# 2. name it
SUPER_ADMIN_EMAIL=owner@example.com
# 3. grant
pnpm db:bootstrap-admin
```

The script **never creates a user**. The account is made through the normal
flow first, so the credential is hashed by Better Auth and no password ever
exists in a script, an env var, or a shell history. If no account matches it
exits non-zero and says to sign up first. Re-running is a no-op, and the grant
is recorded in `audit_log` marked `bootstrap` — it has no acting user, which is
exactly the fact worth recording.

**Rejected alternative:** auto-promoting the first user to sign up. On a public
deployment that is a land grab — whoever signs up during the deploy window owns
the platform.

## Using it

```ts
// A server action or route handler. FIRST statement, before anything else.
const actor = await requirePermission("lesson:publish");
```

Three rules, and they are not negotiable:

1. **The server is the only gate.** A hidden menu item or a disabled button is
   convenience. It tells an honest user what they can do; it stops nobody.
   `tests/lib/authz-enforcement.test.ts` walks every server action and route
   handler and fails the build when one mutates without a check.
2. **The actor comes from the session.** Never from a `userId` in a body, a
   query string, or a header. The same test greps for that and fails on it.
3. **No cross-request cache.** `getPermissionContext` is wrapped in React's
   `cache()`, which is per request, so one render does one query. It is
   deliberately _not_ a TTL cache: a revoked role has to take effect on the
   user's very next request. Permissions are likewise never baked into Better
   Auth's session cookie cache, or a demotion would linger for that window.

## Adding a permission

1. Add it to `PERMISSIONS` in `db/seed/rbac.ts` with a description.
2. Grant it to whichever seeded roles should have it, in the same file.
3. Add it to the resource/action lists above if it introduces a new one.
4. `pnpm db:seed` — idempotent, and it reconciles each seeded role's grants to
   exactly what the spec says, so removing a permission from a role actually
   revokes it.

The seed deliberately does **not** delete roles or permissions that are absent
from the spec: the Super Admin can create both at runtime, and a deploy that
silently removed a role somebody created — cascading its grants away with it —
would be a data-loss bug wearing a seed script's clothes.
