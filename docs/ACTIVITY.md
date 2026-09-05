# Activity: what is recorded, how long it is kept, and who can take a copy

Chemlab records what people do in `activity_events`. This document is the
operational half of that: the two scheduled jobs that keep the table honest,
the retention windows they enforce, and the rules the CSV exports follow.

The design half — why `activity_events` is not `audit_log`, why the verb list
is closed, why the funnel starts at "registered" — lives in the code, next to
the thing it explains (`lib/activity/verbs.ts`, `lib/activity/funnel.ts`,
`db/schema/activity.ts`).

## The two jobs

| Job          | Command          | When                           | Safe to repeat |
| ------------ | ---------------- | ------------------------------ | -------------- |
| Daily rollup | `pnpm rollup`    | Once a day, after UTC midnight | Yes            |
| Retention    | `pnpm retention` | Once a day, any time           | Yes            |

Neither is scheduled by the application. **Where they run is the owner's
call** — a cron on the host, a scheduled GitHub Action, or by hand. Both are
idempotent, both are safe to run late, and both are safe to interrupt, so a
missed night is caught up by the next run rather than needing a repair.

### `pnpm rollup`

Aggregates a closed day into `activity_daily_rollup`, which is what every
dashboard chart reads. Today is never rolled up — it is counted live, because
a rollup row for the current day is wrong the moment anybody does anything.

```bash
pnpm rollup                                   # yesterday
pnpm rollup --from 2026-01-01                 # that day up to yesterday
pnpm rollup --from 2026-01-01 --to 2026-02-01 # a range, `to` exclusive
```

A missed run costs history, not the current view: the dashboard still shows
today correctly, and yesterday reappears as soon as the job is run for it.

### `pnpm retention`

Enforces the two windows below. This is the one job in the repository that
deletes rows nobody can get back, so `--dry-run` first is the habit worth
having.

```bash
pnpm retention --dry-run   # report what would go, change nothing
pnpm retention             # delete and anonymise
pnpm retention --event-days 365 --pii-days 30
```

Work is done in batches of 5,000 rows with a ceiling of 200 batches per run.
The ceiling exists so a job pointed at years of backlog finishes and exits
rather than running until something kills it; when it is reached the job says
so, and the next run continues. Batching also keeps each statement's lock
short — a single unbounded `DELETE` on this table blocks the inserts arriving
while it runs, and every one of those is somebody's page loading.

## Retention

| Data                                   | Kept for | Then                            |
| -------------------------------------- | -------- | ------------------------------- |
| `ip_address`, `user_agent` on an event | 90 days  | Set to NULL, the event survives |
| The event itself                       | 180 days | Deleted                         |
| `audit_log`                            | For ever | Never pruned                    |
| `activity_daily_rollup`                | For ever | Never pruned                    |

Two windows, not one, and the difference is the point. The **event** — "somebody
submitted an exam at 14:02" — is what the dashboards are built on. The
**personal columns** attached to it answer a narrower question ("was this
account shared?") that stops being askable long before the aggregate stops
being useful. So the older half of the retained window keeps its counts and
loses its personal data.

The IP is already truncated when it is written (`lib/activity/ip.ts`), so what
the anonymise pass removes is a coarse address, not a precise one. It removes
it anyway.

The rollup outlives both windows deliberately: it holds counts, never a person,
so a year-old chart survives the events behind it being deleted. `audit_log` is
a security record with a trigger refusing UPDATE and DELETE — the retention job
does not touch it, and must not be made to.

The windows are checked for coherence at startup: personal data cannot be
configured to outlive the events carrying it. With the windows the wrong way
round, the anonymise pass would find nothing to do — everything old enough
would already be deleted — and the job would report success every night while
enforcing nothing.

## Exports

`GET /api/admin/export?dataset=…` streams a CSV. Three datasets:

| Dataset    | Permission        | Extra grant                                | Cap     |
| ---------- | ----------------- | ------------------------------------------ | ------- |
| `events`   | `activity:export` | `activity:read_pii` adds IP and user agent | 100,000 |
| `attempts` | `exam:export`     | —                                          | 50,000  |
| `funnel`   | `activity:export` | —                                          | 1,000   |

Rules that hold for all three:

- **The screen's filters go into the file.** The download link carries the
  current query string, minus paging. An export that quietly returned
  everything while the screen showed one filtered week would be the worst kind
  of wrong: plausible, and impossible to notice from the file.
- **Personal columns are absent from the query**, not blanked afterwards, for a
  caller without the grant.
- **Every download is recorded** as an `admin.exported` activity event, before
  the stream starts — a download cancelled halfway still read the rows it
  received.
- **Ten exports per user per hour.** The window reopens when the oldest export
  in it falls out, and the refusal carries `Retry-After`.
- **A caller without the grant gets 404, not 403**, matching every admin page:
  a 403 confirms the dataset exists and that the account is one grant short.
- The file is UTF-8 **with a BOM** and CRLF line endings, and any cell starting
  `=`, `+`, `-`, `@` or a control character is prefixed with an apostrophe.
  Without that, a user agent reading `=cmd|' /c calc'!A0` is a shell command in
  an administrator's spreadsheet.

An export leaves the building, and the retention windows above stop applying to
it the moment it does. That is why the export is a separate grant from reading
the same data on screen.

## The analytics connection budget

Admin analytics do not share a database client with the public site. They use
`db/analytics-client.ts`, which is deliberately different from `db/client.ts`
in three ways:

|                     | Interactive (`getDb`)                             | Analytics (`getAnalyticsDb`)                            |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| URL                 | `DATABASE_URL`                                    | `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL` |
| Driver              | Neon HTTP for Neon hosts, otherwise node-postgres | node-postgres, always                                   |
| Pool                | Sized for traffic                                 | `max: 2`                                                |
| `statement_timeout` | None                                              | 5s, in the connection's startup packet                  |

The point is not that today's dashboards are slow — they are not; every chart
reads `activity_daily_rollup` for closed days and a bounded live query for
today. The point is structural: an analytics query written next year cannot
exhaust the pool serving `/lessons`, because it is not that pool, and it
cannot run away, because the bound is set on the connection rather than
remembered at each call site.

node-postgres always, rather than mirroring `db/client.ts`'s URL-based choice,
because `statement_timeout` is a **session** setting and Neon's HTTP driver has
no session to set it on — each query there is an independent request.
`DATABASE_URL_UNPOOLED` is preferred for the same reason: a transaction-mode
pooler can hand the next statement a different backend, so a setting applied at
connect would land on somebody else's work.

### Two things deliberately left on the interactive client

**`rollUpDay`** — the write half of `db/queries/admin/rollup.ts`. It is a
scheduled batch write, not a dashboard read: nobody waits on it, it is invoked
from `pnpm rollup` rather than a request, and it aggregates a whole day in one
statement. Under a five-second cap it would fail on exactly the days with the
most data. It is also no threat to the pool it shares, running once a day from
a script process rather than once per page view.

**Nothing else.** In particular, the CSV exports **do** run on the analytics
client, and that was the call worth making explicitly.

### Why the exports share the dashboards' timeout

A large export legitimately runs for minutes, and five seconds looks like the
wrong ceiling for it. It is not, because `statement_timeout` bounds one
**statement**, not one download. Every export in `db/queries/admin/export.ts`
is an async generator over keyset batches of `EXPORT_BATCH_SIZE` rows: the long
part is the loop, and each statement inside it reads a bounded page through an
index.

So the timeout costs the exports nothing — and it buys something. An export
batch that takes more than five seconds has lost the keyset paging that makes
it safe to run at all (a regression to `OFFSET`, a dropped index, a filter that
stopped being sargable). The alternatives were to give the analytics client a
timeout long enough for the worst export, which would leave the dashboards
unprotected, or to leave the exports on the interactive pool, where a
hundred-thousand-row download would compete with `/lessons` for connections.
Both trade away the guarantee this client exists for.

The one visible consequence: a saturated analytics pool refuses new exports
(`connectionTimeoutMillis`, 5s) rather than queueing them behind a slow
dashboard. Contention inside analytics stays inside analytics.

## Where to look when something is wrong

| Symptom                                            | Where to look                                        |
| -------------------------------------------------- | ---------------------------------------------------- |
| A chart is empty for a past day                    | `pnpm rollup --from <day> --to <day+1>`              |
| A chart is empty for today                         | The live query, not the rollup — check the events    |
| IP addresses older than 90 days                    | The retention job is not running                     |
| The retention job reports the same work twice      | It cannot; check you are not looking at a dry run    |
| A download 404s for someone who can see the screen | They hold `activity:read` but not `activity:export`  |
| A download 429s                                    | Ten per hour, per user. `Retry-After` says when      |
| A dashboard or export errors with SQLSTATE `57014` | A statement passed the analytics client's 5s cap     |
| An export fails to start under load                | The analytics pool is saturated; `max: 2`, by design |
