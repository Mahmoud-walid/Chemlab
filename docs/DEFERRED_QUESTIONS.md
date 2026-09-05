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

## Per-issue open questions

Each planning issue carries its own `## Open questions` section for decisions
scoped to that work — schema details, policy choices, UX calls. This file holds
only what cuts across issues or blocks work outright.

Worth reading before the relevant phase starts: #10 and #14 (data modelling),
#18 and #22 (identity and permission policy), #19 (analytics retention), #25
(moderation), #26 (exam policy), #28 (presence privacy).

---

## Resolved decisions

| Date       | Question              | Decision                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | Auth stack            | **Better Auth** — TypeScript-first, Drizzle-native, roles/permissions plugins fit dynamic RBAC                                                                                                                                                                                              |
| 2026-09-04 | Media storage         | **Cloudinary** — signed uploads, image and video transforms, CDN                                                                                                                                                                                                                            |
| 2026-09-04 | Production push       | **Self-hosted Web Push / VAPID** — standard, no vendor, subscriptions in our DB                                                                                                                                                                                                             |
| 2026-09-04 | CI alerts             | **Web Push** through the same pipeline, **plus Slack**                                                                                                                                                                                                                                      |
| 2026-09-04 | Database              | **Neon Postgres + Drizzle ORM**                                                                                                                                                                                                                                                             |
| 2026-09-04 | i18n library          | **next-intl** — already a dependency, App Router native                                                                                                                                                                                                                                     |
| 2026-09-04 | UI components         | **shadcn/ui via its CLI**, never hand-copied                                                                                                                                                                                                                                                |
| 2026-09-04 | Local database        | **Local PostgreSQL in development**, Neon kept as the hosted option; the driver is chosen from the connection string                                                                                                                                                                        |
| 2026-09-04 | Content rendering     | **`/`, `/lessons` and `/quiz` render on demand**, so `pnpm build` still works with no database; detail routes prerender when one is present. Revisit with ISR once the admin panel exists                                                                                                   |
| 2026-09-04 | Email verification    | **Not required to sign in**, but required for Google account linking. Requiring it needs an email provider, which is not chosen yet                                                                                                                                                         |
| 2026-09-04 | Cookie cache          | **5 minutes** (`COOKIE_CACHE_SECONDS`). Bounds how long a revoked session — and later a revoked permission — keeps working                                                                                                                                                                  |
| 2026-09-04 | Anonymous attempts    | **Discarded at sign-in**, not adopted. Adopting them means trusting a client-supplied score                                                                                                                                                                                                 |
| 2026-09-04 | Deny rules            | **None.** Pure allow-lists; an exception like "editor but cannot delete" is a narrower role. Deny rules make effective permissions impossible to display honestly                                                                                                                           |
| 2026-09-04 | Page open/close       | **Its own `page:toggle` permission** under a `page` resource, not `setting:update`. Keeps the admin nav's `page:read` meaningful and separates "change a setting" from "take a page offline"                                                                                                |
| 2026-09-05 | Admin landing         | **A dashboard**, not a redirect to the first accessible section. A redirect makes `/admin` mean something different per role, so a bookmark lands somewhere unpredictable                                                                                                                   |
| 2026-09-05 | Admin locale          | **Follows the visitor's locale**, like the rest of the site. Pinning the panel to English would make Arabic the second-class half of a bilingual product                                                                                                                                    |
| 2026-09-05 | Admin styling         | **Visual continuity** with the public site, distinguished by the sidebar chrome rather than a separate accent. Revisit if operators report confusing the two                                                                                                                                |
| 2026-09-05 | Quizzes vs exams      | **"Quizzes" everywhere** — the table, the public `/quiz` route, the seed data and the `quiz:*` permissions all say quiz. #16 says "exams", but `exam:read` already means _view attempts and scores_                                                                                         |
| 2026-09-05 | Pages with no switch  | **`/admin`, `/sign-in`, `/sign-up`, `/profile` and `/maintenance` can never be closed.** Closing them would close the page that reopens them; `pnpm pages:check` fails when a route belongs to neither set                                                                                  |
| 2026-09-05 | Settings sections     | **Per-section permissions collapsed to two**: `setting:update` for General, Features, Content, Notifications and Languages, `setting:update_security` for Security. #23 asked for six; five near-identical names are noise, and Security is the one with a real privilege boundary          |
| 2026-09-05 | Locale kill switch    | **`localization.offeredLocales` controls where a language is OFFERED**, not whether it is served. The locale list is compile-time and drives `generateStaticParams`, so a settings row cannot take 238 prerendered Arabic pages offline. A real kill switch is a routing change             |
| 2026-09-05 | Notification defaults | **One key per event** (`notifications.commentReply`, …) rather than one `notifications.defaults` object. A per-key row is what makes the audit trail readable: "weekly digest turned off by X", not a diff of two JSON blobs                                                                |
| 2026-09-05 | Attempt tables        | **Built on `quizzes`, not new `exams` tables.** #26 sketched a parallel content model; #58 and #60 already shipped one with an admin UI and most of the same columns. Two models for one concept is how a product grows two half-working exam screens                                       |
| 2026-09-05 | Partial credit        | **`(correct − incorrect) / total correct`, floored at zero, off by default.** All-or-nothing makes ticking every option on a 2-of-4 question pay off about as often as answering carefully                                                                                                  |
| 2026-09-05 | Per-question timers   | **Not at launch.** They force one-question-at-a-time delivery and remove the ability to revisit an earlier answer — a worse test for a small gain                                                                                                                                           |
| 2026-09-05 | Changing an answer    | **Allowed until submit.** The current UI locking an answer immediately is a limitation of storing results in `sessionStorage`, not a decision anybody made                                                                                                                                  |
| 2026-09-05 | Editing mid-attempt   | **Frozen at `quiz_revision`.** Re-scoring a sitting against questions the candidate never saw is not a fix                                                                                                                                                                                  |
| 2026-09-05 | The answer key        | **Two columns, one trigger.** `correct_option_id` is what the editor writes; `quiz_options.is_correct` is what scoring reads and the only one multiple choice can use. A trigger syncs them, because an application-level convention holds only until somebody writes the row from a script |
