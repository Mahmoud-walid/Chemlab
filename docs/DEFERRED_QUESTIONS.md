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

## Per-issue open questions

Each planning issue carries its own `## Open questions` section for decisions
scoped to that work — schema details, policy choices, UX calls. This file holds
only what cuts across issues or blocks work outright.

Worth reading before the relevant phase starts: #10 and #14 (data modelling),
#18 and #22 (identity and permission policy), #19 (analytics retention), #25
(moderation), #26 (exam policy), #28 (presence privacy).

---

## Resolved decisions

| Date       | Question          | Decision                                                                                                                                                                                  |
| ---------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | Auth stack        | **Better Auth** — TypeScript-first, Drizzle-native, roles/permissions plugins fit dynamic RBAC                                                                                            |
| 2026-09-04 | Media storage     | **Cloudinary** — signed uploads, image and video transforms, CDN                                                                                                                          |
| 2026-09-04 | Production push   | **Self-hosted Web Push / VAPID** — standard, no vendor, subscriptions in our DB                                                                                                           |
| 2026-09-04 | CI alerts         | **Web Push** through the same pipeline, **plus Slack**                                                                                                                                    |
| 2026-09-04 | Database          | **Neon Postgres + Drizzle ORM**                                                                                                                                                           |
| 2026-09-04 | i18n library      | **next-intl** — already a dependency, App Router native                                                                                                                                   |
| 2026-09-04 | UI components     | **shadcn/ui via its CLI**, never hand-copied                                                                                                                                              |
| 2026-09-04 | Local database    | **Local PostgreSQL in development**, Neon kept as the hosted option; the driver is chosen from the connection string                                                                      |
| 2026-09-04 | Content rendering | **`/`, `/lessons` and `/quiz` render on demand**, so `pnpm build` still works with no database; detail routes prerender when one is present. Revisit with ISR once the admin panel exists |
