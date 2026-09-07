# Media: uploads, folders, and reclaiming bytes

Chemlab stores lesson images and video, exam question media, and avatars in
Cloudinary. This document covers what is built; `#27` is the issue, and the
parts that need a real Cloudinary account are not built yet.

## Nothing is built that can run without an account

In place today:

- the `media`, `media_usages` and `user_media_quota` tables, with a migration;
- `lib/media/signing.ts` — the Cloudinary signature, both directions;
- `lib/media/paths.ts` — the folder and public-id convention;
- `lib/media/constraints.ts` — what may be uploaded, and under which
  permission;
- the `media:upload_video` permission;
- the environment variables, reported by `pnpm env:check` and the admin
  settings screen.

Not built: `POST /api/media/sign`, `POST /api/media/confirm`, the upload
dropzone, the `next/image` Cloudinary loader, HLS video delivery, and
`scripts/media-gc.ts`. Each of those can only be verified against a real
account, and a signature endpoint that has never signed anything a real
Cloudinary accepted is a guess with tests around it.

## The file never touches this server

The browser uploads straight to Cloudinary. This server's only role is to sign
the request that authorises it.

This is not an optimisation. A serverless function has a request-body limit
measured in single-digit megabytes and a maximum duration measured in seconds;
a 200 MB lesson video cannot be proxied through one at any speed. So the file
goes browser → Cloudinary, and what crosses this server is a signature.

Which means **the signature is the entire security model.** The folder, the
public id and the resource type are chosen here and hashed here. A client that
rewrites any of them rewrites the hash, and Cloudinary refuses the upload. The
guarantee is not "the client was asked to upload into this folder" — it is
"no other folder was ever signed".

The signature is good for **ten minutes**, not Cloudinary's own hour. It is a
bearer authorisation to write into our account; the legitimate gap between
asking and uploading is seconds, and an hour is fifty extra minutes in which
one captured from a log or a proxy still works.

Incoming responses and webhooks are verified the same way before a word of
them is believed. Without that, "the upload finished, it is a 2 KB image" is a
sentence anybody can POST — which is why `bytes`, `format` and the dimensions
are written from Cloudinary's signed response and never from a request body.

## Folders

```
chemlab/<environment>/<kind>/<yyyy>/<mm>/<entity-id>/<random>
    chemlab/production/lessons/2026/09/8f3c1d2e/V1StGXR8_Z5jdHi6B
    chemlab/preview-pr-42/avatars/2026/09/...
    chemlab/development/exams/2026/09/...
```

`<environment>` comes from `CLOUDINARY_UPLOAD_FOLDER`, **set per deployment and
never derived in code from `NODE_ENV`**. A preview deployment runs a production
build and `NODE_ENV` reads `"production"` there — deriving it is precisely how
a preview's uploads land in the production folder, and how its clean-up then
takes real content with them. Making it a variable that must be set means a
missing value is a configuration error rather than a silent default of
"production".

It is validated as a single lowercase path segment. A value with a slash in it
would change the folder _depth_, and every prefix query written against this
convention would then match the wrong tree.

The date segments keep any one folder browsable in Cloudinary's console; a flat
folder of ten thousand assets is not something a human can work in.

The trailing name is **16 random bytes, not the author's filename**, for four
independent reasons: it cannot collide; it does not publish
`IMG_20260904_final_v3_REAL.jpg` to every reader; it sidesteps the unicode and
path-traversal questions that browser-supplied bytes raise on their way into a
URL; and it makes a draft lesson's images unguessable. That last one is why
this project needs no signed delivery URLs — lesson and exam media is public
content behind no paywall, and signed URLs would defeat CDN caching for no
benefit. Unlisted-until-published is what an unguessable name buys.

## What may be uploaded

| Kind              | Types                | Cap            | Permission           |
| ----------------- | -------------------- | -------------- | -------------------- |
| Avatar            | jpeg, png, webp      | 2 MB           | `media:create`       |
| Lesson/exam image | jpeg, png, webp, gif | 10 MB          | `media:create`       |
| Lesson/exam video | mp4, webm, quicktime | 200 MB, 10 min | `media:upload_video` |

Checked on the server **before** a signature exists, and mirrored in
Cloudinary's upload preset so a client that skips our UI entirely is still
refused. The client's own check is advisory: it exists to say "too big" before
a ten-minute upload rather than after.

**SVG is absent, and that is a decision.** An SVG is XML, it can carry script,
and it would be served from our own delivery domain — a stored one is a stored
cross-site scripting payload waiting for a reader to open it directly.
Cloudinary offers sanitisation; the safe default is not to accept the format.
Recorded as Q42 in case lesson authors turn out to need vector diagrams.

**Video has its own permission** because its cost profile is nothing like an
image's. An image is transformed once and served from a CDN; a video is
transcoded per rendition and billed per viewer, so one lesson video watched by
a class can outweigh every image on the platform. Splitting the permission
means "may add pictures" is grantable without the line item that can end a free
tier in an afternoon. `admin` and `editor` hold it; nobody else does, and
whether a normal account ever should is Q41.

## Why there are tables at all

Cloudinary is not a database. Its console can list what exists; it cannot
answer "which lesson is this picture in", "who uploaded it", or "is anything
still using it" — and without those answers, deleting a byte is a guess.

So `media_usages` records every reference, one row each. Not a refcount column:
a number drifts, and a row per reference cannot. An asset with no usage rows is
an orphan; an asset with two is shared, and deleting the lesson that holds one
of them must not remove it.

`block_id` is part of the primary key and defaults to `''` rather than null.
Two blocks in one lesson using the same picture are two references, and
removing one of them is not removing the last. It is not nullable because
Postgres makes every primary-key column `NOT NULL` whether the schema says so
or not — a nullable column in a key is a constraint that disagrees with its own
declaration, and every cover image would fail to insert.

`media.owner_id` is `ON DELETE SET NULL`, not cascade: deleting a
contributor's account must not take a published lesson's illustrations off the
page.

## Deletion is soft, and reclamation is a job

Deleting a lesson sets `deleted_at` on assets that have no remaining usages. It
does **not** call Cloudinary's destroy API inline. Three reasons: a lesson
delete is often a mistake and an undo must be possible; the same asset may be
referenced by another lesson or a translation, so deletion has to be
reference-driven; and a remote call inside the delete transaction can fail and
leave the database and Cloudinary disagreeing about what exists.

The trade accepted: up to 30 days of storage paid for on deleted content, and
reclamation that depends on a job actually being run. The alternative — inline
destroy — trades that small cost for unrecoverable loss on a misclick.

Avatars are the exception. Replacing one destroys the previous asset
immediately: it can have no other reference, and somebody who replaces a photo
reasonably expects the old one to be gone.

## Configuration

| Variable                   | Where              | Why                                                                       |
| -------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `CLOUDINARY_CLOUD_NAME`    | Server             | Part of every upload and delivery URL                                     |
| `CLOUDINARY_API_KEY`       | Server             | Identifies the account on an upload                                       |
| `CLOUDINARY_API_SECRET`    | **Server only**    | Signs every upload. A copy of it can write anything into the account      |
| `CLOUDINARY_UPLOAD_FOLDER` | **Per deployment** | The environment prefix. Never derived from `NODE_ENV` — see Folders above |

All four, or none: three out of four reports as **not configured**, because the
fourth failure happens at upload time and reporting "configured" sends somebody
looking everywhere except the variable that is actually missing.

None of them may carry a `NEXT_PUBLIC_` prefix. `pnpm bundle:check` greps the
built client output for the secret's value and fails the build if it appears.
