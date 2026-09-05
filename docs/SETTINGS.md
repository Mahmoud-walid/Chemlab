# Settings: what lives in the environment, and what lives in the database

Chemlab has two places configuration can live, and exactly one rule for
choosing between them:

> **Environment variables hold secrets and boot-time infrastructure. The
> `settings` table holds runtime product configuration.**

Nothing that must stay secret has a row. That is not a convention — it is
enforced by a test (`tests/lib/settings-registry.test.ts`) asserting that no
registry key name matches `/secret|password|token|api[_-]?key|private|credential/i`.

## Why the line is drawn there

Renaming the site or closing registration should not be a redeploy. Those are
product decisions, made by someone looking at the admin panel, and a
`NEXT_PUBLIC_` variable is inlined at build time — changing one means a
rebuild, and it is published to every visitor besides.

A database URL is the opposite. It carries its password inline, it is needed
before the app can read anything (including a settings row), and an editor role
misconfigured for five minutes must not be able to display it. A settings table
that _can_ hold a secret is a settings table that leaks one eventually, and the
first sign is usually an audit log full of it: every change to a setting records
its old and new value in `activity_events`, which is safe only because no
secret can be there.

## What the screen may say about a secret

One boolean: **Configured** or **Not configured**.

Never the value, never a masked prefix, never a length. A length alone can
distinguish two candidate keys, and a prefix is a partial disclosure with no
upside — nobody debugging a broken integration needs the first four characters,
they need to know whether the variable is set.

`lib/settings/config-status-core.ts` computes those booleans from presence
alone; `lib/settings/config-status.ts` is the `server-only` wrapper that reads
`process.env`. The split exists so tests can pass a fabricated environment, and
so an accidental client import is a build error rather than a page that
silently reports everything as unconfigured.

Half a credential counts as **not** configured. A Google client id without its
secret fails at the OAuth callback with an error that reads like a bug in the
app; reporting it as configured is how somebody spends an afternoon on the
wrong problem. The same rule gates the UI: an OAuth provider whose credentials
are absent cannot be enabled, and the checkbox says why rather than vanishing.

## Validation happens in three layers

Each sees something the others cannot:

1. **The zod schema** in `lib/settings/registry.ts` sees one value. It runs in
   the browser and on the server, so the rules are identical in both.
2. **The cross-key rules** in `lib/settings/constraints.ts` see the
   configuration as it would be _after_ the write — current values merged with
   the submission, including keys the submitted form does not render. That is
   what catches "the Languages tab just removed the language the General tab
   defaults to".
3. **The environment gate** in the write action sees `process.env`. A browser
   has no idea whether Google's credentials exist, so this check cannot live in
   a schema the browser imports.

## Permissions

`setting:read` gates the page. `setting:update` covers most sections;
`setting:update_security` covers the Security section on its own — session
lifetime, the rate limits and the sign-in provider list decide who gets in and
how hard it is to try, and trusting somebody to rename the site is not the same
decision.

The write action resolves the permission **from the registry entry of each key
being written**, never from a section the client names. Otherwise the section
argument becomes the authorization, and a request that submits a `security.*`
key while claiming to be a General save would be checked as a General save.

A section the viewer cannot edit renders read-only rather than disappearing:
the platform's configuration stays legible to anyone who can see the page, and
a section that vanished would read as "this does not exist".

## What `localization.offeredLocales` does and does not do

It controls where a language is **offered** — the language switcher and the
`hreflang` links. It does **not** take an already-published language offline.

The locale list is a compile-time constant in `i18n/routing.ts`. It drives
`generateStaticParams`, the proxy's matcher and the message-key types, so
turning Arabic "off" in a settings row would leave a few hundred prerendered
Arabic pages answering exactly as before. The key is named for what it actually
does; a real per-locale kill switch is a routing change, recorded on #23.
