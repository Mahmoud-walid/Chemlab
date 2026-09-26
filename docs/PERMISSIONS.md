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
`update_security`, `void`, `write`, `review`, `delete_hard`, `subscribe_ci`,
`upload_video`.

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

`media:upload_video` is separate from `media:create` for a reason that is
about money rather than trust. An image is transformed once and served from a
CDN; a video is transcoded per rendition and billed per viewer, so **one**
lesson video watched by a class can outweigh every image on the platform.
Splitting it means "may add pictures" is grantable without also granting the
line item that can end a free tier in an afternoon. `admin` and `editor` hold
it — the roles that write the lessons a video would go in. **Q41** (2026-09-21) settled that no
other role should have it: letting learners submit video would be a different
feature — a moderated submission queue — not a wider grant here. See
`docs/MEDIA.md`.

`notification:subscribe_ci` gates the **Development** section of
`/profile/settings` — build alerts for this repository — and is the one
permission here that grants no power over anything. It says "works on this
project", and nothing else. It exists rather than a role check because both
alternatives are wrong. Deriving it from `admin:access` contradicts what
`ci_notification_preferences` says out loud: holding admin is not a request to
be woken by a build, and somebody who wants build alerts should not have to be
granted admin to get them. Leaving it ungated puts branch names, commit
messages and failure detail on the settings page of a site aimed at children.
**No role holds it by default**, like the two `delete_hard` permissions; a
Super Admin grants it. The API answers **404** without it rather than 403 —
somebody who does not work on this repository has no business learning that it
notifies anybody about its builds.

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

| Role        | Key           | What it is                                                                        |
| ----------- | ------------- | --------------------------------------------------------------------------------- |
| Super Admin | `super_admin` | Everything, implicitly. Protected and undeletable.                                |
| Admin       | `admin`       | Runs the platform day to day. Defines roles, out of permissions it already holds. |
| Editor      | `editor`      | Writes and publishes content. No users, roles or settings.                        |
| Moderator   | `moderator`   | Comments and the people who wrote them, nothing else.                             |
| Member      | `member`      | Every signed-up visitor. No admin permissions.                                    |

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

After that first grant, every other role is assigned from `/admin/users/<id>`.
The script remains the only way to create a Super Admin, and only ever the
first one.

## The admin screens

`/admin/roles` needs `role:read`; each action inside needs its own permission.
**Admin holds `role:create`, `role:update`, `role:delete` and `role:assign`** —
it can define roles, not only staff the ones that exist.

That does not make Admin a Super Admin in instalments, and the reason is the
ceiling rather than the gate: every path that puts a permission somewhere —
granting a role, editing a role's grants, cloning a role — refuses anything the
actor does not hold themselves, and `super_admin` by key. So the most powerful
role an Admin can create is one exactly as powerful as an Admin.

What widening Admin deliberately did **not** include is the three permissions no
role holds by default. They stay runtime grants, and three e2e specs assert the
panel offers nothing without them.

Assigning happens on the person, at `/admin/users/<id>`, because "what can this
account do" is a question about the account.

### Which roles, not just whether

`role:assign` answers _may this person touch roles at all_. It does not answer
**which**, and getting that wrong is privilege escalation rather than a bug: an
Admin holds `role:assign`, so if that alone were enough to grant `super_admin`,
Admin and Super Admin are one role and the table above is decoration.

The rules are in `lib/authz-roles.ts`, pure and exhaustively tested, and every
one of them returns **all** its reasons rather than the first:

| Rule                                                                           | Why                                                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `super_admin` may only be granted or revoked by a Super Admin                  | The key decides, because the role holds no grant rows to compare                                   |
| A role may not be granted if it grants anything the actor does not hold        | Escalation by proxy: grant a stronger role, then ask its holder to act for you                     |
| The same applies to **revoking**                                               | Somebody who could revoke what they could not grant can dismantle a role they are not trusted with |
| You may not revoke a role from yourself if it costs you your own `role:assign` | The only way back is a shell on the database                                                       |
| The last `super_admin` holder cannot be revoked                                | The service layer says it in a sentence; `user_roles_protect_last_super_admin` says it in SQL      |

Only what is **added** is checked against the actor when editing a role's
grants. Removing a permission the actor does not hold is not escalation, and
refusing it would leave an Admin unable to tidy up a role they can otherwise
edit.

### A system role's grants cannot be edited in the UI

Not a missing feature. `db/seed/authorization.ts` reconciles every seeded role's
grants to exactly what `db/seed/rbac.ts` says, and the seed runs on every
deploy — so an edit through the screen would work, look like it worked, and
silently revert. The form is absent and the screen says where the answer lives.
Change a system role in `db/seed/rbac.ts` and re-seed.

Custom roles created at runtime are `is_system: false`, which the seed
deliberately never touches, so their grants **are** editable — and so are their
name and description. A system role's name is not: `roles_protect_system` freezes
only the key, so the database would accept the rename and
`db/seed/authorization.ts` would put the spec's name back on the next deploy with
nothing reporting it. Same trap as the grants, same answer.

### Cloning is how a system role's power becomes customisable

Since a system role's own grants cannot be edited, "Editor, plus hard delete" has
to be a **copy**: the new role starts with the source's grants and is a custom
role the seed never reconciles. Without it that role is sixteen boxes ticked by
hand with one of them silently forgotten.

Cloning carries the same ceiling as granting, and it has to: a copy that took
grants the actor does not hold would mint exactly the role they may not hand out,
and `refusalsForAssign` would then permit handing it out, because by that point
the permissions belong to the new role.

Cloning `super_admin` needs no special case — it holds no grant rows, so the copy
is an empty role. The short-circuit lives on the key and does not travel.

This is also the documented route to the three permissions no role holds by
default: put them on a custom role, and assign that.

Super Admin gets no checkbox list at all: rendering 53 ticked boxes would
suggest the power comes from those rows and that unticking one removes it, which
is the exact misunderstanding the short-circuit design prevents.

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
