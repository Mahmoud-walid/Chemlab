# Deferred questions

Decisions that need the owner (@Mahmoud-walid), recorded here instead of being
guessed silently. Each entry states why it blocks work, the options, and a
recommendation so answering is a yes/no rather than an essay.

Answer by editing this file, or in the linked issue — then the entry moves to
**Resolved decisions** at the bottom with the date.

---

## Blocking — work cannot start without these

### Q1. Neon database credentials

**Blocks:** #10 (Drizzle foundation), and everything after it.

I cannot create the Neon project — it needs your account. Please create one and
add both connection strings as a GitHub Actions secret **and** a Vercel
environment variable:

- `DATABASE_URL` — the **pooled** string, used by the running app
- `DATABASE_URL_UNPOOLED` — the **direct** string, used by migrations

Neon's connection pooler does not support the session-level statements that
migrations issue, which is why both exist. Never paste either into an issue, a
PR, or chat.

**Also decide:** one Neon project with a branch per environment (recommended —
branching is Neon's main advantage and gives production-like test data), or
separate projects for development and production.

### Q2. Google OAuth client

**Blocks:** #13-ish (Better Auth).

Create an OAuth 2.0 client in Google Cloud Console and provide `GOOGLE_CLIENT_ID`
and `GOOGLE_CLIENT_SECRET` as secrets. Authorised redirect URIs will be
`http://localhost:3000/api/auth/callback/google` for local work plus the
production equivalent. The consent screen needs an app name, support email and a
privacy-policy URL — **we do not have a privacy policy yet**, which Google
requires before a public app leaves testing mode. See Q8.

### Q3. Cloudinary account

**Blocks:** the media pipeline, and therefore lesson images/video and avatars.

Provide `CLOUDINARY_CLOUD_NAME` (may be public), `CLOUDINARY_API_KEY` and
`CLOUDINARY_API_SECRET` (server-only).

### Q4. Slack webhook for CI alerts

**Blocks:** the Slack half of CI notifications; the Web Push half can ship first.

Provide `SLACK_WEBHOOK_URL`, or say you want Web Push only for now.

---

## Product decisions

### Q4b. Allow GitHub Actions to open pull requests (repo setting — BLOCKING releases)

The release pipeline works: on the first run it parsed the commits, decided
`0.1.0` → `0.2.0`, and created the branch and commit. It then failed on the last
step with:

> GitHub Actions is not permitted to create or approve pull requests.

That is a repository setting, off by default, and I cannot change it:

**Settings → Actions → General → Workflow permissions → tick _Allow GitHub
Actions to create and approve pull requests_.**

The next merge to `main` will then open the release PR. (The branch
`release-please--branches--main` already exists from the failed run; it will be
reused, not duplicated.)

**Alternative:** store a fine-grained PAT as a secret and pass it to the action.
**Recommendation:** use the checkbox. A PAT is a long-lived credential with your
identity attached, for no benefit here — the setting is narrower and expires
with nothing.

### Q4c. The licence swap dropped the original author's notice

`LICENSE.md` (MIT, © jayemscript) was deleted in #6/#7 and replaced with
`LICENSE` (Apache 2.0). Two problems came with it, neither urgent but both
worth closing:

**1. The Apache file still has the placeholder.** Line 189 reads
`Copyright [yyyy] [name of copyright owner]` — the boilerplate was never filled
in, so the licence currently names no owner at all. That is just an unfinished
edit, and I can fix it as soon as you tell me the name and year to use.

**2. 14 of the 22 commits on `main` are still jayemscript's.** The periodic
table, quiz section and lessons came to you under MIT, and MIT says its
copyright notice "shall be included in all copies or substantial portions of
the Software". You can licence **your own** contributions however you like, and
MIT explicitly permits sublicensing — but the original notice is supposed to
travel with the inherited code, and right now it does not exist anywhere in the
repository.

**Recommendation:** keep Apache 2.0 for the project and add a `NOTICE` file —
which is Apache's own convention for exactly this — recording that portions
originate from jayemscript's MIT-licensed chemverse, with the original notice
text. It costs one small file, removes the compliance question entirely, and
credits the person whose code the app is largely built from.

I have not done this unprompted because licensing is your call, not mine. Say
the word and it is a five-minute PR.

### Q5. Who may register, and is email verification required?

Options: open registration; Google-only (no password to leak, no reset flow to
build); or invite/allowlist while the platform is young.

**Recommendation:** open registration with Google OAuth **and** email+password,
with email verification required before commenting. Comments without verified
identity are a spam magnet, and you have asked for comments everywhere.
Verification email needs a transactional sender — see Q6.

### Q6. Transactional email provider

Password reset, email verification and admin invitations all need outbound mail.
Options: Resend (simplest, good free tier), AWS SES (cheapest at volume, more
setup), Postmark (best deliverability, paid).

**Recommendation:** Resend. Also needs a verified sending domain, which requires
DNS access — do you have that for the domain you plan to use?

### Q7. Production domain

`NEXT_PUBLIC_SITE_URL` currently defaults to `http://localhost:3000`. The live
site, OAuth redirect URIs, OG images and canonical URLs all need the real
domain. The README still links `chemverse-io.vercel.app`.

### Q8. Privacy policy and terms

Once accounts exist, you are storing personal data — email, avatar, IP and user
agent in `activity_events`, presence timestamps. Google's OAuth consent screen
requires a privacy-policy URL, and GDPR requires one if any user is in the EU.
This is a content task only you can sign off.

**Also needed:** a retention window for `activity_events` (recommendation: 90
days for IP and user agent, indefinite for the aggregated event itself), and
whether users can delete their account and what happens to their comments.

### Q9. Arabic content translation

UI strings I can translate. The 13 lessons and 6 quizzes are chemistry prose —
machine translation of scientific terminology produces confident nonsense, so I
will not do it silently.

Options: (a) ship bilingual UI with English-only content and a "not yet
available in Arabic" notice; (b) you or a chemistry-literate translator author
the Arabic; (c) machine-translate as a first pass for you to correct.

**Recommendation:** (a) now, (b) as content work later. The schema will support
per-locale content from day one either way.

### Q10. Arabic as default locale?

Is Arabic the primary audience, or is English default with Arabic available?
Affects the default locale, whether `/` redirects, and which font loads first.

### Q11. Exam attempt policy

Unlimited retakes, or capped? Is the best score kept or the latest? Should
students see correct answers immediately after submitting, or only after the
exam closes? This changes the anti-cheat model — showing answers immediately
means a second attempt is trivially gamed.

### Q12. Presence privacy

You asked for online/offline status "visible to everyone normally". Should users
be able to appear offline? **Recommendation:** yes, with a profile setting
defaulting to visible. Always-public presence is a common privacy complaint.

### Q13. Comment moderation

Pre-moderation (nothing appears until approved) or post-moderation (appears
immediately, admins remove)? **Recommendation:** post-moderation with reporting,
plus rate limits. Pre-moderation on an education platform for kids is defensible
but needs someone actually watching the queue.

### Q14. Minimum age and children's data

The site is described as kid-friendly. Accounts for children under 13 trigger
COPPA in the US and equivalents elsewhere, including parental-consent
requirements. **Recommendation:** state a minimum age of 13 in the terms and do
not collect birthdates, unless you specifically intend to serve younger children
— in which case that is a legal design problem to solve before launch, not
after.

---

## Technical decisions with a recommendation

### Q15. Which date library survives

`moment`, `moment-timezone`, `dayjs` and `date-fns` are all installed and **none
is imported by any source file**. **Recommendation:** keep `date-fns` (tree-shakeable,
actively maintained, good i18n including Arabic locales), drop the other three.
Moment is in maintenance mode and ships a large bundle.

### Q16. Unused dependencies

About twenty packages are installed and never imported: `leaflet`, `pdfkit`,
`jspdf`, `xlsx-populate`, `socket.io-client`, `chrono-node`, `blob-stream`,
`markdown-it`, `@dnd-kit/core`, `@headless-tree/*`, `axios`, `js-cookie`,
`zustand`, the `i18next` family, and others.

**Question:** were any of these installed for a feature you still intend to
build? Otherwise #9 removes them. `next-intl` stays regardless — it is the i18n
library.

### Q17. TipTap and react-table: remove now, or keep for imminent use?

The audit found `@tanstack/react-table` and all nine `@tiptap/*` packages unused
today — but #16 needs a data table and #20 needs a rich-text editor within a
phase or two.

**Recommendation:** remove them in #9 and re-add at current versions when the
feature lands. An unused dependency is an upgrade and supply-chain cost with no
benefit, and re-adding is one command. Say the word if you would rather keep
them installed.

### Q18. Feature flags for a partially-built platform

As phases land, half-built features will exist on `main`. **Recommendation:**
gate each new surface behind a setting in the admin settings table so `main`
stays deployable and you control what users see. Confirm you want this, since it
adds a small amount of work per feature.

### Q19. Squash-only merges (repo setting — needs you)

The repository currently allows **squash, merge commits and rebase**. Release
automation reads the commit messages that land on `main`, and only squash
merging guarantees those messages are the linted PR titles. A merge commit puts
every work-in-progress commit ("aa", "fix content tab") onto `main`, where
release-please will try to parse them.

**Recommendation:** Settings → General → Pull Requests → untick _Allow merge
commits_ and _Allow rebase merging_, leaving squash only. Also tick _Allow
auto-merge_ (still off) and _Automatically delete head branches_.

### Q20. Should the host deploy from tags instead of `main`?

Right now Vercel deploys every push to `main`, so a change is live before it is
released. Deploying from tags instead makes "merged" and "released" genuinely
different states, and the release PR becomes the deploy gate.

**Recommendation:** deploy `main` to a staging URL and tags to production once
there are real users. Until then, deploying `main` is fine and faster.

### Q21. A pre-release channel?

Do you want `beta`/`next` pre-releases (`0.3.0-beta.1`), or is `main` → release
the only path until 1.0? **Recommendation:** no pre-release channel yet — it
doubles the release surface for a project with one deployment target.

### Q22. Arabic register — MSA, confirmed?

The UI is written in **Modern Standard Arabic**, the default assumption for
educational content and understood across every Arabic-speaking country.
Egyptian-leaning phrasing would feel warmer to an Egyptian audience and foreign
to a Gulf or Maghrebi one. Say if you want the register changed — it is a
find-and-replace in `messages/ar.json`, not a code change.

### Q23. Should Arabic ship publicly before the lessons are translated?

The UI is fully Arabic. The **content** — 13 lessons, 60 exam questions,
119 element summaries — is still English, and shows a "not yet available in
Arabic" notice.

**Recommendation:** ship it. A student who reads Arabic gets an Arabic
interface immediately and English content with an honest label, which beats
waiting months for a translation that has not been commissioned. Say the word
and I will instead gate `ar` behind a feature flag until content is ready.

### Q24. English at `/en/...` too?

English currently lives on the unprefixed URLs (`/lessons`), Arabic at
`/ar/lessons`. Full symmetry (`/en/lessons`) would mean redirecting every
existing URL.

**Recommendation:** keep `as-needed`. Nothing already published breaks, and no
SEO history is lost. The asymmetry only becomes awkward if Arabic later becomes
the default locale.

### Q25. Element names in Arabic

Element **symbols** (H, Na, Fe) are locale-invariant and stay Latin. Element
**names** (Hydrogen → الهيدروجين) are standard, unambiguous chemistry
terminology and could be translated safely, unlike the encyclopaedia summaries.
Category names (Noble Gas → غاز نبيل) are already translated.

**Question:** do you want the 119 element names translated? It is a bounded,
low-risk data task — unlike the prose, where I will not guess.

---

### Q28 — should preview deployments support Google sign-in?

Google forbids wildcard redirect URIs, so a preview URL that changes per
deployment can never complete an OAuth callback. Either a stable preview alias
is registered in the console alongside production, or previews are
credential-only (email/password still works there).

**Question:** register a preview alias, or accept credential-only previews?
Nothing is blocked either way — this only decides whether the Google button
works on a preview.

---

### Q29 — should a second Super Admin be required before going live?

The database refuses to remove the _last_ Super Admin, so administrative access
cannot be locked out by accident. It does not stop there being exactly one — and
one holder is a bus factor of one: losing that account means losing
administrative access with no recovery path short of shell access to the
database. `pnpm db:bootstrap-admin` prints a warning when it leaves you with a
single holder.

**Question:** treat "at least two Super Admins" as a production readiness
requirement, or accept one? Nothing is blocked either way; this is about what
happens when the owner loses their account.

---

### Q30 — adopt Next's Cache Components for the authenticated header?

The account menu has to know who you are, and a server-side session read calls
`headers()`. In the App Router a dynamic API anywhere in a layout opts every
route beneath it out of static rendering — which is how adding the header in
#51 silently cost the public site its prerendering, 238 element and quiz pages
included.

The header now resolves the session in the browser and shows a neutral
placeholder until it does, which restores prerendering at the cost of the
header being right one frame late.

Next 16's [Cache Components](https://nextjs.org/docs/app/getting-started/caching)
is the sanctioned fix: the static shell prerenders and the authenticated hole
streams in behind a `<Suspense>` boundary. It is a whole-app rendering change —
`cacheComponents: true`, then every route that reads the session is re-validated
— so it belongs in its own piece of work rather than being bolted onto an
unrelated PR.

**Question:** adopt Cache Components as a dedicated task, or leave the header
resolving client-side? Nothing is blocked either way.

---

### Q31 — a section-level permission refusal answers 200, not 404 — RESOLVED

**Resolved 2026-09-05. It was a bug, not a constraint.**

The reasoning in the original note was sound and the diagnosis was wrong. The
admin layout resolves the section's permission from the `x-pathname` header the
proxy forwards — and that header had not been arriving since #56. With it
absent the layout fell back to `"/admin"`, so `permissionForPath` only ever
returned `admin:access`, which the layout had already checked. The section check
was inert, the refusal fell through to the page, and by the time a page can call
`notFound()` Next has committed a 200.

So the status was wrong because the check was running in the wrong place, not
because the right place was unreachable.

The cause: `withPathname` copied next-intl's response headers wholesale, and
Next encodes `request: { headers }` as `x-middleware-override-headers` plus one
`x-middleware-request-<name>` per header. Copying next-intl's copy of that
machinery over ours replaced our override list with theirs. Nothing failed —
`headers().get("x-pathname")` simply returned null and every reader took its
fallback. Skipping every `x-middleware-*` header when copying fixes it.

`/admin/quizzes` for a moderator now answers **404**, asserted in four e2e
specs. `/admin` still answers 200 for anyone holding `admin:access`, which is
correct: the dashboard is theirs to see.

Two other things that were quietly broken by the same header and now work: the
maintenance page can find the closed route's own message, and signing in from a
deep admin link returns you to the page you asked for rather than to `/admin`.

---

### Q34 — the page switch is enforced in the proxy, and caches for 15 seconds

The open/closed map is read in `proxy.ts` and cached in module memory for 15
seconds. That TTL is the ceiling on how long a closed page stays reachable
across processes: writes call `invalidatePageCache()`, so in the process that
handled the click the switch is immediate, but a second instance keeps serving
the old answer until its own copy expires.

Fifteen seconds is a guess, chosen because the map is seven rows that change
rarely and the proxy runs ahead of every request. It is deliberately not zero:
a database read per request, in front of every page, is what the cache exists
to avoid.

The Next docs warn that a proxy may be deployed separately from the app and
should not rely on shared caches, so a shared store is not a drop-in fix — it
would be a second piece of infrastructure in the request path.

**Question:** is a worst case of ~15 seconds acceptable for "I closed this page
and a visitor could still see it"? If not, the options are a shorter TTL (more
queries), or a shared cache with a revalidation channel (more moving parts).
My default is to leave it until the site runs on more than one instance, where
the question actually bites.

---

### Q35 — does `exam_attempts` belong to #19 or to #26?

#19 scope §3 says attempts and server-side grading belong to the activity
issue. #16's "out of scope" says taking an exam, timers, scoring and attempt
storage belong to #26. Both cannot own it, and building it twice is worse than
either.

**My default: #26 owns the tables and the grading, #19 owns everything that
reads them.** The score is produced by the same server action that receives the
answers, so splitting the write from the read means #19 ships a table nothing
fills and #26 ships a runtime with nowhere to put its results.

That makes #19's attempts slice depend on #26 rather than precede it. The
activity spine and the dashboards-minus-attempt-charts are unaffected either
way, which is why this did not block the first slice.

**Question:** agreed, or would you rather #19 own the schema and #26 fill it?

---

### Q36 — `activity:read_pii`, because the model has two segments

#19 asks for `activity:read:pii`. The permission vocabulary is
`resource:action`, two parts, checked by a regex and drawn from two closed
lists. A third segment would mean teaching the whole model to parse one — every
`requirePermission` call, the seed, the admin UI — for a single permission.

Shipped as **`activity:read_pii`**, an action of its own. The shape test in
`tests/lib/authz-core.test.ts` had to be loosened to allow an underscore in the
action half; it already allowed one in the resource half, so the restriction
looks incidental rather than intended. A stronger check went in alongside:
every action must appear in the declared `ACTIONS` list, so a typo still cannot
invent a permission.

Flagging it because loosening a test to fit new code is exactly the move worth
being suspicious of, and it should be your decision rather than mine alone. If
you would rather have the three-segment form, it is a contained change now and
a much larger one later.

---

### Q33 — should a question be allowed more than one correct answer?

#16 asks for "options with one or more correct answers". The stored model has
one: `quiz_questions.correct_option_id` points at a single option, which #14
chose deliberately over the JSON's string answer — a rename of an option used
to orphan the answer silently.

All sixty seeded questions are single-answer, so nothing is lost today. But
supporting several would mean replacing that reference with `is_correct` on
each option, which trades one guarantee for another: a question would no longer
be structurally unable to have zero correct answers, so a CHECK or a trigger
would have to enforce what the reference enforces now. It also changes what
scoring means — partial credit, all-or-nothing, negative marking — and scoring
belongs to #26.

The question editor therefore uses a radio group per question, which is honest
about what can be stored. Swapping it for checkboxes later is a contained
change; the schema and the scoring rules are not.

**My default is to keep single-answer until #26**, where the scoring rule and
the storage change can be decided together. **Question:** do you want
multiple-answer questions, and if so, how should a partly-correct answer be
scored?

---

### Q37 — should a push subscription survive sign-out, and how long do delivery rows live?

**Raised by:** #17, now closed. Neither answer blocks anything: both have a
working default, and both are cheap to change later. Recorded because they are
policy calls rather than technical ones.

**a. Sign-out.** A subscription is stored per (user, endpoint), and the
endpoint is unique — so re-subscribing the same browser UPDATES the row,
including its `user_id`. A shared device signed into a second account
therefore stops pushing the first account's notifications, which is the
property that matters. What is _not_ done today is deleting the subscription
at sign-out: a device the person signs back into keeps working without asking
permission again.

**Recommendation: leave it.** Dropping it at sign-out means every sign-in
needs a fresh subscribe, and on a browser that has already granted permission
that is invisible — until it silently fails on the one that has not. The risk
it would address (a shared computer pushing to somebody who has left) is
already covered by the `user_id` update on re-subscribe.

**b. Delivery retention.** `push_deliveries` rows are kept 7 days, which is
what makes "I never got it" answerable — the row says whether it was sent,
what the push service replied, and how many attempts it took.

**Recommendation: leave it at 7 days** unless you want longer for support. It
is a queue table, not a history: at any real volume it is the fastest-growing
table in the database, and nothing reads a fortnight-old delivery.

---

### Q38 — the four policy calls in #25 (comments)

None of these blocks the schema or the API, so the work proceeds on the
recommendation below and changing any of them later is a small patch, not a
rewrite. Say the word on any you disagree with.

**a. Default sort — newest, or top?** _Proceeding with newest._ This is lesson
Q&A: a question posted an hour ago needs an answer, and `top` buries it under
last month's best joke. `top` is available as a choice; it is just not the
default. (`top` is also not stable under concurrent voting, so it is a
snapshot sort — the sort key is captured at first page load and kept for the
session's later pages, or a comment could move between pages while you
scroll.)

**b. Can anonymous visitors read comments?** _Proceeding with yes — read
public, write signed-in._ The lessons themselves are public, and a discussion
nobody can read until they have an account is a discussion that never starts.
Posting, reacting and reporting all require a session.

**c. Do dislike counts stay visible?** _Proceeding with visible, because you
asked for likes and dislikes explicitly._ Worth knowing what the evidence says
though: public dislike counts measurably suppress participation, which is why
YouTube stopped showing them. The alternative — collect them, show the count
only to the author and to moderators, keep the button's own state for the
reader — gives the moderation signal without the chilling effect. That is a
display change and one query, if you want it.

**d. A minimum account age or verified email before a first comment?**
_Proceeding with neither._ Email verification is not required to sign in
today, so requiring it to comment would silently block everybody. The spam
controls are the rate limit (1 per 15s, 10 per hour, burst 3), a minimum body
length, a duplicate-body check, and link-count heuristics that flag rather
than block. If spam becomes real, an account-age gate is the cheapest next
lever.

---

## Per-issue open questions

Each planning issue carries its own `## Open questions` section for decisions
scoped to that work — schema details, policy choices, UX calls. This file holds
only what cuts across issues or blocks work outright.

Worth reading before the relevant phase starts: #10 and #14 (data modelling),
#18 and #22 (identity and permission policy), #19 (analytics retention), #25
(moderation), #26 (exam policy), #28 (presence privacy).

---

## Resolved decisions

| Date       | Question                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | Auth stack                         | **Better Auth** — TypeScript-first, Drizzle-native, roles/permissions plugins fit dynamic RBAC                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-04 | Media storage                      | **Cloudinary** — signed uploads, image and video transforms, CDN                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-04 | Production push                    | **Self-hosted Web Push / VAPID** — standard, no vendor, subscriptions in our DB                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-09-04 | CI alerts                          | **Web Push** through the same pipeline, **plus Slack**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-04 | Database                           | **Neon Postgres + Drizzle ORM**                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-09-04 | i18n library                       | **next-intl** — already a dependency, App Router native                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-04 | UI components                      | **shadcn/ui via its CLI**, never hand-copied                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-04 | Local database                     | **Local PostgreSQL in development**, Neon kept as the hosted option; the driver is chosen from the connection string                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-04 | Content rendering                  | **`/`, `/lessons` and `/quiz` render on demand**, so `pnpm build` still works with no database; detail routes prerender when one is present. Revisit with ISR once the admin panel exists                                                                                                                                                                                                                                                                                           |
| 2026-09-04 | Email verification                 | **Not required to sign in**, but required for Google account linking. Requiring it needs an email provider, which is not chosen yet                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-04 | Cookie cache                       | **5 minutes** (`COOKIE_CACHE_SECONDS`). Bounds how long a revoked session — and later a revoked permission — keeps working                                                                                                                                                                                                                                                                                                                                                          |
| 2026-09-04 | Anonymous attempts                 | **Discarded at sign-in**, not adopted. Adopting them means trusting a client-supplied score                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-04 | Deny rules                         | **None.** Pure allow-lists; an exception like "editor but cannot delete" is a narrower role. Deny rules make effective permissions impossible to display honestly                                                                                                                                                                                                                                                                                                                   |
| 2026-09-04 | Page open/close                    | **Its own `page:toggle` permission** under a `page` resource, not `setting:update`. Keeps the admin nav's `page:read` meaningful and separates "change a setting" from "take a page offline"                                                                                                                                                                                                                                                                                        |
| 2026-09-05 | Admin landing                      | **A dashboard**, not a redirect to the first accessible section. A redirect makes `/admin` mean something different per role, so a bookmark lands somewhere unpredictable                                                                                                                                                                                                                                                                                                           |
| 2026-09-05 | Admin locale                       | **Follows the visitor's locale**, like the rest of the site. Pinning the panel to English would make Arabic the second-class half of a bilingual product                                                                                                                                                                                                                                                                                                                            |
| 2026-09-05 | Admin styling                      | **Visual continuity** with the public site, distinguished by the sidebar chrome rather than a separate accent. Revisit if operators report confusing the two                                                                                                                                                                                                                                                                                                                        |
| 2026-09-05 | Quizzes vs exams                   | **"Quizzes" everywhere** — the table, the public `/quiz` route, the seed data and the `quiz:*` permissions all say quiz. #16 says "exams", but `exam:read` already means _view attempts and scores_                                                                                                                                                                                                                                                                                 |
| 2026-09-05 | Pages with no switch               | **`/admin`, `/sign-in`, `/sign-up`, `/profile` and `/maintenance` can never be closed.** Closing them would close the page that reopens them; `pnpm pages:check` fails when a route belongs to neither set                                                                                                                                                                                                                                                                          |
| 2026-09-05 | Settings sections                  | **Per-section permissions collapsed to two**: `setting:update` for General, Features, Content, Notifications and Languages, `setting:update_security` for Security. #23 asked for six; five near-identical names are noise, and Security is the one with a real privilege boundary                                                                                                                                                                                                  |
| 2026-09-05 | Locale kill switch                 | **`localization.offeredLocales` controls where a language is OFFERED**, not whether it is served. The locale list is compile-time and drives `generateStaticParams`, so a settings row cannot take 238 prerendered Arabic pages offline. A real kill switch is a routing change                                                                                                                                                                                                     |
| 2026-09-05 | Notification defaults              | **One key per event** (`notifications.commentReply`, …) rather than one `notifications.defaults` object. A per-key row is what makes the audit trail readable: "weekly digest turned off by X", not a diff of two JSON blobs                                                                                                                                                                                                                                                        |
| 2026-09-05 | Attempt tables                     | **Built on `quizzes`, not new `exams` tables.** #26 sketched a parallel content model; #58 and #60 already shipped one with an admin UI and most of the same columns. Two models for one concept is how a product grows two half-working exam screens                                                                                                                                                                                                                               |
| 2026-09-05 | Partial credit                     | **`(correct − incorrect) / total correct`, floored at zero, off by default.** All-or-nothing makes ticking every option on a 2-of-4 question pay off about as often as answering carefully                                                                                                                                                                                                                                                                                          |
| 2026-09-05 | Per-question timers                | **Not at launch.** They force one-question-at-a-time delivery and remove the ability to revisit an earlier answer — a worse test for a small gain                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-05 | Changing an answer                 | **Allowed until submit.** The current UI locking an answer immediately is a limitation of storing results in `sessionStorage`, not a decision anybody made                                                                                                                                                                                                                                                                                                                          |
| 2026-09-05 | Editing mid-attempt                | **Frozen at `quiz_revision`.** Re-scoring a sitting against questions the candidate never saw is not a fix                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-09-05 | The answer key                     | **Two columns, one trigger.** `correct_option_id` is what the editor writes; `quiz_options.is_correct` is what scoring reads and the only one multiple choice can use. A trigger syncs them, because an application-level convention holds only until somebody writes the row from a script                                                                                                                                                                                         |
| 2026-09-05 | Anonymous sittings                 | **A quiz now needs an account**, per #26 — attempts are per-user rows. The landing copy still says "without an account", which is now only true of lessons and the periodic table. Worth the owner's call: keep it, or add an unrecorded practice mode                                                                                                                                                                                                                              |
| 2026-09-05 | Public quiz routes                 | **Kept at `/quiz`**, not moved to `/exams`. #26 asked for permanent redirects only because it assumed the rename; not renaming keeps every published link working and matches the "Quizzes everywhere" decision. `/quiz/results` does redirect — it was a `sessionStorage` screen                                                                                                                                                                                                   |
| 2026-09-05 | `types/quiz.ts`                    | **Kept, trimmed.** #26 asked for it to be deleted, but it is the schema of `data/quiz.json`, which is still the seed input. `QuizAttempt` — the `sessionStorage` result shape — is gone with the client-side scoring it served                                                                                                                                                                                                                                                      |
| 2026-09-05 | Old local scores                   | **Discarded, not migrated.** Anything in `sessionStorage` was computed in the browser from an answer key the browser also held. Writing those numbers in as real results would launder unverifiable scores into a permanent record                                                                                                                                                                                                                                                  |
| 2026-09-05 | Voiding a sitting                  | **A status, not a delete, and it still counts against the attempt cap.** "This attempt does not count, and here is why" is a different fact from "this attempt never happened"; handing back a sitting would turn the sanction into a reward. A reason of five characters or more is required server-side                                                                                                                                                                           |
| 2026-09-05 | `exam:void`                        | **Its own permission**, alongside `exam:read`. Reading the scores and striking one out are different levels of trust: a void changes somebody's record and is visible to them                                                                                                                                                                                                                                                                                                       |
| 2026-09-05 | Per-question stats                 | **Percent correct is out of the sittings that ANSWERED**, with blanks counted as skipped. Averaging blanks in makes a long paper look harder than it is — a question nobody reached is not a hard question                                                                                                                                                                                                                                                                          |
| 2026-09-05 | Media on questions                 | **Deferred to #27.** #26 slice 3 was to carry it, but #27 is a hard blocker on the owner supplying Cloudinary credentials — nothing in that pipeline can be verified without a real account                                                                                                                                                                                                                                                                                         |
| 2026-09-05 | Timeline paging                    | **Keyset on `(created_at, id)`, never OFFSET.** `activity_events` is append-only and grows at the head, so an OFFSET page two is a different set of rows every time anybody does anything — rows shift past the boundary and are silently skipped. `id` breaks the tie because several events share a millisecond                                                                                                                                                                   |
| 2026-09-05 | Verb message keys                  | **Nested by group, not flat with dots.** `verbs: { "exam.submitted": … }` cannot be resolved by next-intl at all — it splits a key on dots and walks — so every screen showing a verb was rendering the raw key. Nothing caught it because nothing resolved a label the way next-intl does                                                                                                                                                                                          |
| 2026-09-05 | `notFound()` status                | **Not assertable from a page here.** These admin routes are `force-dynamic` and stream, so the 200 header is already sent when the page calls `notFound()`. The layout's `notFound()` still returns 404 — it runs before streaming. Tests assert the rendered page, not the status                                                                                                                                                                                                  |
| 2026-09-05 | "Last seen"                        | **Labelled "last sign-in", because that is what it measures.** It is the newest session row; a signed-in tab left open all week does not refresh one, so "last seen" would be a claim the data cannot support                                                                                                                                                                                                                                                                       |
| 2026-09-05 | Rollup vs matview                  | **A rollup TABLE, not a materialised view.** `REFRESH MATERIALIZED VIEW CONCURRENTLY` recomputes everything on a schedule we do not control; a table is incrementally updatable with `ON CONFLICT DO UPDATE`, cheap to backfill, and re-runnable for one day without touching the rest                                                                                                                                                                                              |
| 2026-09-05 | Rollup key columns                 | **`object_type`/`object_id` are NOT NULL with an empty-string default.** Postgres treats NULLs in a primary key as distinct, so nullable columns would let the same (day, verb) row insert repeatedly and break idempotency silently                                                                                                                                                                                                                                                |
| 2026-09-05 | Unmeasured stages                  | **A funnel stage nothing emits shows "not recorded yet", never 0.** Nothing emits `lesson.viewed` until #20 builds the `[slug]` lesson model; "0 people read a lesson" is a false claim, and conversions for later stages are measured against the last MEASURED stage instead                                                                                                                                                                                                      |
| 2026-09-05 | Dashboard date range               | **Fixed at 30 days for v1.** A date picker nobody has asked for is a control to maintain; every query already reads rollups rather than raw events, so widening it later is cheap                                                                                                                                                                                                                                                                                                   |
| 2026-09-05 | Rollup schedule                    | **`pnpm rollup` runs the previous day, and where it runs is the owner's call** — a host cron, a scheduled GitHub Action, or by hand after a backfill. The dashboards count today live, so a missed run costs history rather than the current view                                                                                                                                                                                                                                   |
| 2026-09-05 | Export transport                   | **A GET route handler streaming CSV, not a server action.** A server action would build the whole file in memory, ship it through the RSC payload and reassemble it as a Blob — three copies of a hundred thousand rows, two of them in the browser. A GET streams to disk, cancellable, with no JavaScript                                                                                                                                                                         |
| 2026-09-05 | Export grants                      | **Separate from reading the same data on screen.** `activity:export` and `exam:export` were seeded in #22 and had never been checked anywhere. A file leaves the building and the retention windows stop applying to it, which is a different act from looking at a table                                                                                                                                                                                                           |
| 2026-09-05 | Formula injection                  | **Every cell starting `=`, `+`, `-`, `@` or a control character is prefixed with an apostrophe.** User agents and void reasons are attacker-supplied text, and the person opening the export is the one with the most access                                                                                                                                                                                                                                                        |
| 2026-09-05 | Export rate limit                  | **Ten per user per hour, counted from the `admin.exported` events themselves.** No second table: a limiter reading the audit record cannot drift from it. The window reopens when the oldest export falls out, so one export an hour ago is not punished like ten a second ago                                                                                                                                                                                                      |
| 2026-09-05 | Retention windows                  | **Personal columns 90 days, the events themselves 180.** Two windows because the aggregate stays useful long after "was this account shared?" stops being askable. The job refuses windows the wrong way round — it would look enforced and do nothing                                                                                                                                                                                                                              |
| 2026-09-05 | Retention batching                 | **5,000 rows a statement, 200 statements a run.** An unbounded DELETE holds a lock long enough to block the inserts arriving while it runs, and each of those is somebody's page loading. The ceiling lets a job pointed at years of backlog finish and exit                                                                                                                                                                                                                        |
| 2026-09-05 | Job scheduling                     | **Neither `pnpm rollup` nor `pnpm retention` is scheduled by the application** — where they run is the owner's call, documented in docs/ACTIVITY.md. Both are idempotent and safe to run late, so a missed night is caught up rather than repaired                                                                                                                                                                                                                                  |
| 2026-09-05 | Lesson body shape                  | **Typed blocks on `lesson_sections`, not a `blocks` column on `lessons`.** #20 sketched one array per lesson; sections already exist, carry curriculum position, and have per-section translation rows. The block model becomes the SHAPE of a section body, which keeps the shipped i18n and admin surface and still gives translations a stable per-block id                                                                                                                      |
| 2026-09-05 | Block ids                          | **Derived from slug, section position and paragraph position — never generated.** A translation addresses a block by id, so a random id would orphan every translation on each re-seed or restore. The seed and the data migration follow the same rule so the two agree                                                                                                                                                                                                            |
| 2026-09-05 | Body column shape                  | **A CHECK constraint, not a convention.** `jsonb_typeof(body) = 'array'` means a writer storing the old ProseMirror document fails loudly instead of blanking a lesson for every reader                                                                                                                                                                                                                                                                                             |
| 2026-09-05 | Unrenderable blocks                | **Dropped on read, refused on write.** Strict validation on the write path; the read path keeps the blocks it understands, because a row written before a schema change is already in the table and a blank page is worse than a missing paragraph                                                                                                                                                                                                                                  |
| 2026-09-05 | Media hosts                        | **An allow-list, configured per deployment (`NEXT_PUBLIC_MEDIA_HOSTS`), checked on write AND on render.** Validating only on write protects only the rows written after it. The two hotlinked search-cache images and the YouTube embed in the old `studying-chemistry` route were dropped rather than allow-listed — hotlinking a search engine's image cache is not a media strategy, and #27 owns the real pipeline                                                              |
| 2026-09-05 | Section anchors                    | **`section-N`, from position, not from the heading text.** A text-derived anchor differs between locales, so a link shared from the Arabic page would not resolve on the English one, and renaming a heading would silently break every link into it                                                                                                                                                                                                                                |
| 2026-09-05 | Lesson view events                 | **A client beacon to `/api/lessons/[slug]/view`, not `after()` in the page.** The lesson pages are prerendered, and `after()` inside a static page runs at BUILD time — it would count the build once and no reader ever. The endpoint checks the slug against the table, or it writes an activity row for any string anyone posts                                                                                                                                                  |
| 2026-09-05 | Reading time                       | **Computed at write time and stored.** The same number for every reader and every request; computing it per render charges the reader for an answer that never changes, and computing it per client lets two clients disagree. A video's duration is used when known and skipped when not — no number beats a wrong one                                                                                                                                                             |
| 2026-09-05 | Progress bar direction             | **A CSS variant (`origin-left rtl:origin-right`), not a direction read in JavaScript.** `transform-origin` has no logical keyword, and reading `document.dir` in an effect fills from the wrong side until hydration — a progress bar that empties as an Arabic reader advances                                                                                                                                                                                                     |
| 2026-09-05 | Counting a share                   | **Only a resolved `navigator.share()` or a resolved clipboard write.** A dismissed sheet (`AbortError`) counts nothing and does not fall back to copying — the user said no. Outbound social links are stored with `verified: false` and excluded from the public count: `window.open` to an intent URL says the reader left, not that they pressed Post, and no callback exists that could say otherwise                                                                           |
| 2026-09-05 | `AbortError` detection             | **Matched by `name`, not `instanceof DOMException`.** Safari has shipped plain Errors carrying the name, and a miss turns a dismissal into a counted share — the exact failure the feature exists to prevent                                                                                                                                                                                                                                                                        |
| 2026-09-05 | Engagement tables                  | **Three tables, not one `reactions` table with a `kind` column.** A like is public and counted, a save is private and never totalled publicly, a share is a repeatable event rather than an on/off state. One table would need nullable channel and target columns and a rule nobody can enforce about which apply to which                                                                                                                                                         |
| 2026-09-05 | Like idempotency                   | **The composite primary key, not a check-then-insert.** Reading for an existing row before inserting has a window in which two concurrent requests both see nothing and both write                                                                                                                                                                                                                                                                                                  |
| 2026-09-05 | Share dedupe window                | **One counted share per (lesson, user, channel) per UTC hour, as a partial unique index.** Partial over signed-in verified rows only: NULLs in a unique index compare as distinct, so including anonymous rows would make the index look enforced while doing nothing. The bucket is `at time zone 'UTC'` because an index expression must be IMMUTABLE — and because a window that moved with the reader's time zone would be a different window per connection                    |
| 2026-09-05 | Counter maintenance                | **Database triggers, never application code.** `count = count + 1` in a service drifts the moment a request dies between the two writes, and `on delete cascade` removes a departing user's likes without running any application code at all — a trigger fires anyway. `pnpm reconcile` recomputes from source and reports drift; CI runs it, and it exits non-zero rather than silently repairing                                                                                 |
| 2026-09-05 | Engagement counts on a static page | **Fetched on mount, never rendered on the server.** The lesson pages are prerendered, so a count rendered server-side is the count at BUILD time — wrong by the first like and wrong in a way that looks authoritative. Until the fetch lands the buttons show no number rather than a zero, which would be a claim                                                                                                                                                                 |
| 2026-09-05 | Signed-out engagement              | **A sign-in prompt, not a silent no-op.** The click was real; a like that appears to work and vanishes on reload is worse than being told what would make it work                                                                                                                                                                                                                                                                                                                   |
| 2026-09-05 | Editor document vs storage         | **The bridge translates; the editor's document is never stored.** Storing ProseMirror JSON would make every lesson's schema whatever version of TipTap last saved it, so an editor upgrade that changed a node shape would silently change the column and the renderer would have to track an editor it does not use                                                                                                                                                                |
| 2026-09-05 | Unconvertible editor nodes         | **Dropped, not approximated.** A table pasted from a document has no block that can hold it; turning it into a paragraph of run-on prose would look intentional and read as nonsense                                                                                                                                                                                                                                                                                                |
| 2026-09-05 | Custom TipTap nodes                | **Callout, equation, image and video are registered even though only callouts can be authored today.** TipTap discards nodes whose type it cannot resolve, so without them opening a lesson with a callout and pressing save would DELETE it — silently, and only for the lessons that had one                                                                                                                                                                                      |
| 2026-09-05 | Body saves                         | **A whole-body replace in one transaction, not a per-section diff.** Sections can be added, removed, reordered and retitled in one session; reconstructing which is which from a diff is guesswork that attaches a translation to the wrong paragraph. Block ids are what survive, and they travel inside the bodies                                                                                                                                                                |
| 2026-09-05 | Reading time and revision          | **Recomputed and bumped inside the same transaction as the body.** A reading time belonging to a body that was never committed is worse than a stale one, and a revision that did not move leaves every translation looking current against a body that changed                                                                                                                                                                                                                     |
| 2026-09-05 | Autosave                           | **Debounced at two seconds, and cancelled on unmount.** A save per keystroke is a write per keystroke; a pending save that outlives the page writes a body the author has already navigated away from                                                                                                                                                                                                                                                                               |
| 2026-09-05 | The preview                        | **Renders through `BlockRenderer` — the same component the public page uses.** A preview built on a second renderer can be right while the page is wrong, which is worse than no preview: it is a promise about how the lesson will look that only one of the two is keeping                                                                                                                                                                                                        |
| 2026-09-05 | The editor's own route             | **`/admin/lessons/[slug]/edit`, separate from the settings form.** One page holding an autosaving body next to a submit-button form never makes it clear which changes are already saved                                                                                                                                                                                                                                                                                            |
| 2026-09-05 | Body audit records                 | **The audit row records the revision and the counts, never the bodies.** They are the largest thing in the database and `audit_log` is never pruned; what matters later is that the body changed, by whom, and to which revision                                                                                                                                                                                                                                                    |
| 2026-09-05 | Push transport                     | **Self-hosted Web Push over VAPID.** No vendor, no per-message cost, and the queue is inspectable with SQL — which is what matters when somebody says "I never got it"                                                                                                                                                                                                                                                                                                              |
| 2026-09-05 | Dead subscriptions                 | **A 404 or 410 DELETES the row.** The push service is stating that the address is permanently dead; retrying it forever is how a table of live users becomes a table of ghosts. A 5xx is retried, and a device is pruned only after 20 consecutive failures — a higher bar than a delivery's 5 attempts, because it counts a different thing                                                                                                                                        |
| 2026-09-05 | Push queue                         | **A `push_deliveries` table drained by `pnpm push:drain`, claimed with `for update skip locked`.** A request that triggers 500 notifications writes 500 rows and returns; a serverless function killed part-way through a fan-out leaves rows rather than an unreconstructable half-send. Two drains at once are safe. The honest cost is latency — a notification is as late as the gap between drains                                                                             |
| 2026-09-05 | Drain schedule                     | **The owner's call, like `pnpm rollup` and `pnpm retention`** — a host cron, a scheduled Action, or by hand. Documented in docs/NOTIFICATIONS.md rather than assumed about the host                                                                                                                                                                                                                                                                                                 |
| 2026-09-05 | Notification click targets         | **Resolved against our own origin, and anything else becomes the home page.** A notification looks like it came from the site, so a payload that could carry any URL would hand whoever can enqueue one a phishing primitive                                                                                                                                                                                                                                                        |
| 2026-09-05 | Payload size                       | **Checked before the row is written, not at send time.** A 413 arrives long after the code that built the payload has returned, and by then there is nothing to fix but a row in a queue                                                                                                                                                                                                                                                                                            |
| 2026-09-05 | Subscription identity              | **The endpoint, with a unique index.** Re-subscribing the same browser updates rather than inserts — without it a user who reloads the settings page ten times receives ten copies of every notification. The row's `user_id` updates too, so a shared device signed into a second account stops pushing the first account's notifications                                                                                                                                          |
| 2026-09-05 | Secrets in the bundle              | **`pnpm bundle:check` now greps the built client output for every server-only secret's VALUE**, not its name. Proven by rendering `VAPID_PRIVATE_KEY` into a client component and watching the build fail — an earlier probe passed only because the check had never loaded `.env.local` and so was searching for an empty string                                                                                                                                                   |
| 2026-09-05 | Route-handler sessions             | **`requireUserOr401()` returns either the user or a ready-made 401, never both.** `requireUser()` redirects, which is right for a page and wrong for an API: a `fetch` follows the redirect, gets 200 and HTML, and cannot tell that it failed. A helper returning `CurrentUser                                                                                                                                                                                                     | null` would have been a rubber stamp that satisfied the enforcement test while letting the caller ignore the null |
| 2026-09-05 | Service worker source              | **Hand-written `public/sw.js`, not a generated one.** Three event handlers and no offline caching; a build-time generator would add a plugin, a build step and a caching layer nobody asked for, on a Next 16 + Turbopack setup where those plugins are not something to bet the build on. Its decisions are mirrored in a tested module, and a test asserts the two agree                                                                                                          |
| 2026-09-05 | Stale service workers              | **`Cache-Control: no-cache`, plus `skipWaiting()`/`clients.claim()`, plus `update()` on load and on visibilitychange.** A cached worker keeps running the old copy indefinitely once installed — the classic failure mode here, and one that reads as "push stopped working for some people" rather than as a caching bug                                                                                                                                                           |
| 2026-09-05 | The web app manifest               | **In scope for the push transport, not decoration.** Safari on iOS delivers Web Push only to a site installed to the Home Screen, and installation requires a manifest with `display: standalone`. It is NOT there to make the site work offline — there is no caching strategy and no offline page                                                                                                                                                                                 |
| 2026-09-05 | App icons                          | **Placeholders, drawn by `pnpm icons:generate` with a hand-written PNG encoder.** #17 asks whether the owner has a 512px logo; until one exists an installable app needs icons of the right SIZES more than the right artwork. Written without an image library because adding a native dependency to draw two rectangles and a trapezoid is a poor trade                                                                                                                           |
| 2026-09-05 | Permission prompts                 | **Never on page load; only on a button, on a settings page the reader chose to open.** A dialog on first paint is the most reliable way to be refused for ever, since a refused browser will not show its dialog again. `denied` and iOS-in-a-tab get instructions and no button at all — a control that cannot work is worse than none                                                                                                                                             |
| 2026-09-05 | iOS detection order                | **Checked BEFORE the support check.** An iOS tab reports no `PushManager`, so a naive support check tells somebody whose browser supports notifications perfectly well once installed that their browser cannot — wrong, and unhelpful                                                                                                                                                                                                                                              |
| 2026-09-05 | E2E account addresses              | **Deterministic per (role, worker).** No timestamp, so accounts are reused across runs and the sign-up limiter is never approached on a persistent database. Per worker, because the limiter is per identifier: one shared account per role looked tidier and concentrated every worker's traffic on one address, which is the fastest way to be refused. Sign-in retries a 429 too — treating "slow down" as "wrong password" is what made a shared account look like a broken one |
