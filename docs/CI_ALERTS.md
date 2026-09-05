# CI alerts

A red `main` that nobody notices is worse than a red `main` that pages
somebody: every branch cut afterwards inherits it. This is the path from a
failed workflow run to a phone, and — when a webhook is configured — to Slack.

It reuses the push transport in `docs/NOTIFICATIONS.md` rather than building a
second one, so a CI alert is delivered by the same queue, the same service
worker and the same VAPID pair as everything else.

## The shape of it

```
ci.yml: notify job  ──HMAC-signed POST──▶  /api/ci/notify  ──▶  push_deliveries
   (needs: the four                              │                    │
    real jobs, if: always)                       └──▶ Slack webhook   └──▶ pnpm push:drain
```

One notification per workflow run, not per job. The `notify` job `needs` all
four real jobs and reads `needs.<job>.result`, which is the only place the
outcome of a parallel job is visible and is exact — no API call, no parsing
logs. Five jobs reporting separately would be five buzzes for one push, four of
them saying nothing new.

## Why a signature and not a token

This endpoint is on the public internet, on the same deployment users hit.
Unauthenticated it is a free spam cannon aimed at whoever opted in.

A bearer token is weaker in three concrete ways:

- **Replayable verbatim.** Anyone who sees one request can resend it for ever.
- **It says nothing about the body.** It authenticates the caller, so a proxy
  that rewrites the payload still passes.
- **It leaks by proximity** — `curl -v`, retry logs, error reports, any HTTP
  debugging done while fixing the workflow — and a leaked value works
  immediately.

So the workflow sends `X-Chemlab-Signature: sha256=<hex>`, an HMAC-SHA256 over
the **raw** body, and the app recomputes it before parsing anything. The secret
is never transmitted. The body carries a `timestamp` and a `nonce`, and
anything more than five minutes old is refused, so a captured request is
worthless by the time it is found in a log.

The comparison uses `timingSafeEqual`. A `===` on a secret-derived value leaks
its length and matching prefix through timing.

**Every refusal is a bare `401`.** Telling a caller whether it was the
timestamp or the signature is telling an attacker which half to work on. A
_signed_ request with a malformed body gets a `400` with a message, because
that is our own workflow sending something wrong.

## The noise policy

**Every failure alerts. A success alerts only when it is the first green after
a red.**

Notifying on every green run trains the recipient to ignore the channel within
a week — and once you ignore the channel you ignore the failures, which defeats
the whole point. Silence is the correct signal for a healthy build.

Pure silence on success is wrong too: after a red `main`, the one thing you
want to know is that it is fixed. So the app looks up the last recorded outcome
for `(repository, branch, job)` in `ci_runs` and sends a recovery alert when
this run is green and that one was not.

Per developer, `successPolicy` can be `never`, `recovery` (the default) or
`always`. Failures always alert, including consecutive ones — each is a
different commit with a different cause. Cancellations default to off: usually
a human pressing cancel or a superseded PR run, not a defect.

## Opting in

**An absent `ci_notification_preferences` row means no CI notifications,
ever.** It is a per-account choice, deliberately not a role check: having admin
rights is not a request to be woken by a build, and somebody who wants build
alerts should not have to be granted admin to get them.

The default branch list is `main` alone, because a red `main` is the emergency.
`["*"]` is everything, and `feat/*` matches a prefix.

## Configuration

| Variable            | Where it lives                        | Why                                                                                                    |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CI_NOTIFY_SECRET`  | GitHub Actions secret **and** the app | The HMAC key. The same value both sides; never transmitted, so a copy of it is the only way to forge   |
| `CI_NOTIFY_URL`     | GitHub Actions secret only            | Where the workflow posts. Always **production** — the alert path must not depend on what may be broken |
| `SLACK_WEBHOOK_URL` | The app, server-only                  | The URL **is** the credential: anyone holding it can post to the channel. Optional                     |

Generate the secret with `openssl rand -hex 32`. None of these may carry a
`NEXT_PUBLIC_` prefix; `pnpm bundle:check` greps the built client output for
all three and fails the build if one appears.

With `CI_NOTIFY_URL` or `CI_NOTIFY_SECRET` unset, the `notify` job prints one
line and exits 0. With `SLACK_WEBHOOK_URL` unset, push still delivers and the
response reports `slack: "skipped"`.

## It can never fail the build

The `notify` job is `continue-on-error: true`, runs `curl --max-time 10
--retry 2` with the exit code swallowed, and ends in an explicit `exit 0`. Its
shell does not `set -e`.

A monitoring system that can turn a green build red — or, worse, mask a red one
— is a liability. If the app is down, the secret has rotated, or Slack is
refusing, CI still reports the true build result.

It is also skipped on pull requests from forks, where secrets are unavailable:
it no-ops rather than failing.

## Answering "why did nobody get paged?"

Every run writes a `ci_runs` row whether or not anybody was told, carrying
`notified`, `suppression_reason` and `pushes_queued`. Those last two are
separate on purpose: `notified: true` with `pushes_queued: 0` means the policy
said yes and nobody has a subscription, which is a different problem from the
policy saying no.

```sql
select branch, outcome, failed_jobs, notified, suppression_reason, pushes_queued
from ci_runs
where repository = 'Mahmoud-walid/Chemlab'
order by created_at desc
limit 20;
```

A retried delivery is idempotent: `(repository, run_url, job)` is unique, so
GitHub re-delivering an event or a workflow being re-run does not produce a
second buzz for a failure already seen.
