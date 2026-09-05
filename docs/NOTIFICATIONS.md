# Web Push: keys, subscriptions and the send queue

Chemlab sends its own pushes over VAPID — no vendor, no per-message cost, and
the whole queue is inspectable with SQL, which is what matters when somebody
says "I never got it".

This document covers the **transport**: how a payload reaches a device. What
Chemlab actually decides to notify people about is #21's, and the CI alerts are
#24's; both write the payload contract defined in `lib/push/payload.ts`.

## Keys

```bash
pnpm vapid:keys   # prints a pair in .env form
```

Run it **once** per deployment and keep the result. Regenerating invalidates
every existing subscription: a browser's `PushSubscription` is bound to the
public key it was created with, so a new pair silently stops every subscribed
device from receiving anything, with no error anywhere — the push service
simply rejects the send.

| Variable                       | Where it lives     | Why                                                                                                                            |
| ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The browser bundle | `PushManager.subscribe()` takes it as `applicationServerKey`; there is no server-side way to supply it                         |
| `VAPID_PRIVATE_KEY`            | Server only        | Signs every push. A copy of it lets anybody send notifications that appear to come from this site                              |
| `VAPID_SUBJECT`                | Server only        | A `mailto:` or `https:` URL. Required by the spec, and the address a push provider uses when our sending looks abusive to them |

`pnpm bundle:check` greps the built client output for `VAPID_PRIVATE_KEY` and
the other server-only secrets, and fails the build if one appears. Nothing else
in the toolchain would say so: a stray `import "@/lib/env.server"` from a client
component, or a `NEXT_PUBLIC_` prefix typed onto the wrong variable, puts a
secret in a file served to every visitor.

## The queue

A request that triggers five hundred notifications writes five hundred rows and
returns. It does **not** block on five hundred HTTPS calls: a serverless
function killed part-way through would leave some sent, some not, and no record
of which.

```bash
pnpm push:drain              # send one batch
pnpm push:drain --limit 500  # clear a backlog
```

Where and how often this runs is **the owner's call** — a host cron, a
scheduled GitHub Action, or by hand — the same arrangement as `pnpm rollup` and
`pnpm retention` (see `docs/ACTIVITY.md`). Two drains running at once are safe:
the claim uses `for update skip locked`, so the second skips the rows the first
is holding rather than blocking on them or sending them twice.

**The honest cost is latency.** A notification is as late as the gap between
drains. For a like or a reply that is fine; anything that genuinely must be
instant should send inline and use the queue as its safety net.

## What each failure means

| Response                   | What happens                                        | Why                                                                                                                                           |
| -------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                        | `sent`, and the device's `last_used_at` refreshes   | —                                                                                                                                             |
| **404 / 410**              | **The subscription row is DELETED**                 | The push service is stating that this address is permanently dead. Retrying it forever is how a table of live users becomes a table of ghosts |
| 429                        | Retried, honouring `Retry-After`                    | —                                                                                                                                             |
| 413                        | `failed`, no retry                                  | The payload is too large. Retrying sends the same oversized payload to the same service — this is a bug in the sender                         |
| 400 / 401 / 403            | `failed`, no retry                                  | Our VAPID configuration is wrong. Every subsequent send fails identically until a human fixes it                                              |
| 5xx, or no response at all | Retried with exponential backoff, capped at an hour | The request may never have arrived                                                                                                            |

A delivery is abandoned after 5 attempts. A _subscription_ is pruned after 20
consecutive failures — a higher bar, because it counts a different thing: a
device that failed one notification five times may have been offline, while one
that has failed twenty across days is not coming back.

Finished rows are kept for seven days so "I never got it" can be answered, then
removed. The queue is a queue, not an archive.

## Payloads

One schema, in `lib/push/payload.ts`, written by every sender — so `sw.js` has
exactly one parser to maintain. Two senders inventing their own shapes means
two service-worker code paths, and the one nobody tested is the one that throws
inside a `push` event where no user will ever see the error.

Two limits are enforced before a row is written rather than discovered at send
time:

- **~3 KB.** A payload is encrypted before transmission and the ciphertext must
  fit roughly 4 KB. Send an identifier and let the app fetch the detail; a
  lesson body does not belong in a push.
- **The click target must be on our own origin.** A notification looks like it
  came from the site, so a payload that could carry any URL would hand whoever
  can enqueue one a phishing primitive. Anything off-origin becomes the home
  page.

## Subscriptions

`POST /api/push/subscriptions` registers or refreshes a device;
`DELETE` removes one. Both require a session — an anonymous subscription is a
row nobody could ever send to.

**The endpoint is the identity.** Re-subscribing the same browser updates the
existing row rather than inserting: without that, a user who reloads the
settings page ten times has ten rows and receives ten copies of every
notification. The row's `user_id` is updated too, so a shared device signed
into a second account stops pushing the first account's notifications.

## iOS

Safari on iOS delivers Web Push **only** to a site installed to the Home
Screen as a standalone web app. A plain Safari tab will never receive one, no
matter how correct the code is, and `Notification.requestPermission()` in that
context throws or resolves to `denied`. This is Apple's design.

The manifest that makes installation possible, and the UI that explains this
case instead of showing a button that cannot work, are the browser half of #17.
