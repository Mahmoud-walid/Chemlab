# Authentication

Identity for Chemlab: Better Auth on Drizzle, email/password plus Google, with
database sessions.

Everything here is optional at runtime. With no `BETTER_AUTH_SECRET` the site
serves every public page and the account UI does not render — the same posture
as running with no database. `pnpm env:check` reports which of
"email/password and Google", "email/password only" or "disabled" the current
configuration gives you.

## Where things live

| File                     | What it is                                                                     |
| ------------------------ | ------------------------------------------------------------------------------ |
| `lib/auth-options.ts`    | The configuration. Shared with the tests, deliberately — see below             |
| `lib/auth.ts`            | The server instance: options plus the Next.js cookie plugin, built lazily      |
| `lib/auth-client.ts`     | The browser client                                                             |
| `lib/session.ts`         | `getSession()`, `getCurrentUser()`, `requireUser()` — the authoritative checks |
| `lib/auth-schemas.ts`    | The zod schemas, imported by both the forms and the server                     |
| `lib/safe-redirect.ts`   | `next` / `callbackURL` validation                                              |
| `lib/auth-rate-limit.ts` | The lockout policy, pure so it can be tested without a clock                   |
| `db/schema/auth.ts`      | The tables, ours and the library's                                             |
| `middleware.ts`          | A cookie-presence check only. Never the gate that decides                      |

**Why the options are a separate module.** The integration suite builds its own
instance against a disposable database. The first version of those tests built
its own _options_ too, quietly omitted the profile hook and the CSRF origin
list, and passed. Sharing `buildAuthOptions` means production and the tests
cannot drift on anything security-relevant.

## Decisions

**Database sessions, not stateless JWTs.** A row in `sessions` _is_ the
session: delete it and access ends on the next request. A JWT keeps its claims —
including a role an admin has just revoked — until it expires. The cost is a
lookup per request, which the cookie cache absorbs.

**A five-minute cookie cache.** Better Auth signs a small session snapshot into
a second cookie, so the common path skips the query. The trade-off is the
window: a revoked session can keep working for up to five minutes. That number
is `COOKIE_CACHE_SECONDS` in `lib/auth-options.ts` and is the one place to
change it — the RBAC work may want it shorter, because it also bounds how long
a revoked _permission_ lingers.

**Ids are `text` on the library's tables.** Better Auth generates ids itself.
Accepting its type is cheaper than fighting it at every insert; a custom
`generateId` still returns UUID v7, so ids stay time-ordered and index writes
stay at the right-hand edge of the B-tree. Our own tables keep the `uuid`
convention.

**Profiles are a separate table.** `profiles` is 1:1 with `users` rather than
columns on it, so Better Auth's table can be regenerated on upgrade without
clobbering our fields. The cost is one join, paid in `getCurrentUser()`.

**The origin check is set explicitly.** Better Auth disables it by default when
`NODE_ENV` is `test`. `disableOriginCheck: false` is therefore written out, so
the CSRF defence the integration suite proves is the one production runs. A
security control should not depend on an environment variable.

**Email verification is not required to sign in.** Requiring it needs an email
provider, which is not chosen yet. Only account _linking_ is gated on a verified
address — see below. If you add a provider, revisit this first.

## The security properties, and what proves them

| Property                                                       | Proven by                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Passwords are stored as a memory-hard hash, never in the clear | `tests/integration/auth.test.ts`                            |
| A deleted or expired session row stops resolving               | `tests/integration/auth.test.ts`                            |
| Sign-out deletes the row; the replayed cookie is refused       | `tests/integration/auth.test.ts`                            |
| A forged cookie resolves to nobody                             | `tests/integration/auth.test.ts`                            |
| Cross-origin state-changing requests are refused (403)         | `tests/integration/auth.test.ts`                            |
| Unknown email and wrong password answer identically            | `tests/integration/auth.test.ts`                            |
| Credential sign-in is rate limited per email and per IP        | `tests/integration/auth.test.ts`                            |
| Rate-limit keys are stored hashed, never as raw addresses      | `tests/lib/auth-rate-limit.test.ts`                         |
| A hostile `next` cannot redirect off-origin                    | `tests/lib/safe-redirect.test.ts`, `tests/e2e/auth.spec.ts` |
| Protected routes bounce anonymous visitors and return them     | `tests/e2e/auth.spec.ts`                                    |
| Cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`               | `tests/integration/auth.test.ts`                            |

`__Secure-` is added to the cookie name in production only, because the prefix
is a browser-enforced promise that the cookie was set over HTTPS and local
development is HTTP.

## Rules for anything built on this

**Never accept a user id from the request.** Not from a body, a query string, a
header, or a hidden field. The acting user comes from the session — that is what
`requireUser()` is for. A server action that takes a `userId` turns "edit my
profile" into "edit anyone's profile" the moment someone changes a form field.

**Middleware is not a gate.** It runs on the edge, cannot reach the database
cheaply, and only checks that a session cookie _exists_ — which proves nothing
about whether the session behind it still does. Every protected page, route
handler and server action calls `requireUser()` itself.

**Validate with the shared schema.** The forms validate for the person typing.
The server validates because the client can post anything.

## Account linking

Signing in with Google using the address of an existing account adds a row to
`accounts` against the same `user_id` — never a second `users` row. Google is
the only trusted provider for this, and only because it asserts
`email_verified` in the ID token. Blanket trust here is account takeover by
signup: anyone who can get a provider to assert an address they do not own
inherits the matching account.

## Google OAuth setup

The owner performs this once, in the Google Cloud console. Nothing here should
ever reach a repository.

1. **APIs & Services → OAuth consent screen.** External user type. App name
   `Chemlab`, a support email, the production domain as an authorised domain,
   and a developer contact. Scopes limited to `openid`, `email` and `profile` —
   none is sensitive, so no verification review is needed while the app is in
   Testing.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorised JavaScript origins:** `http://localhost:3000` and
   `https://<production-domain>`.
4. **Authorised redirect URIs, exactly:**
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<production-domain>/api/auth/callback/google`

   Google accepts no wildcards, so preview deployments need either a stable
   registered alias or they are credential-only.

5. While the consent screen is in _Testing_, every tester's Google account must
   be listed explicitly, or sign-in returns `access_denied`.
6. Put the client id and secret in `.env.local` and the deployment's
   environment. Never in `.env.example`, an issue, or a pull request.

`BETTER_AUTH_URL` must match the origin in the redirect URI exactly.
`pnpm env:check` warns when it disagrees with `NEXT_PUBLIC_SITE_URL`.

## Still to come

- Transactional email, and therefore working verification and password-reset
  delivery. The flows and the `verifications` table exist; nothing sends.
- Roles and permissions (`/admin` is protected by the middleware prefix already,
  but nothing grants access to it yet).
- Cloudinary avatars. `profiles.avatar_url` is a plain string and
  `avatar_source` records where the current one came from, so replacing a cached
  Google URL later needs no migration.
- Adopting anonymous quiz attempts at sign-in. They are discarded today: the
  scores live in `sessionStorage`, and trusting a client-supplied score is how a
  leaderboard gets fabricated.
