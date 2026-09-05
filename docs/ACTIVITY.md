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

## Where to look when something is wrong

| Symptom                                            | Where to look                                       |
| -------------------------------------------------- | --------------------------------------------------- |
| A chart is empty for a past day                    | `pnpm rollup --from <day> --to <day+1>`             |
| A chart is empty for today                         | The live query, not the rollup — check the events   |
| IP addresses older than 90 days                    | The retention job is not running                    |
| The retention job reports the same work twice      | It cannot; check you are not looking at a dry run   |
| A download 404s for someone who can see the screen | They hold `activity:read` but not `activity:export` |
| A download 429s                                    | Ten per hour, per user. `Retry-After` says when     |
