# Sequel Sounds — overview

One page. Paste this into a Claude project as background.

## What it is

An internal music supervision tool. Staff run projects; **partners** (music
libraries, labels, composers) send in tracks; **clients** review shortlists on
shared playlists. Only staff have accounts — everyone else acts through an
unguessable share link.

## Stack

React 19 + TypeScript + Vite 8 + Tailwind 4 (SPA). Supabase (Postgres 17,
eu-west-2, project `sveirphsppyfhulymjiu`) for data, staff auth and one Edge
Function. AWS S3 `sequel-sounds-media` (eu-west-2) for media, with an ffmpeg
Lambda — **not in this repo** — that renders MP3 previews and waveform peaks.
Projects and suppliers are mirrored in from Xano. The public site and app shell
are Webflow (`sequelsounds.app`).

## Access model

Staff are Supabase Auth users who sign in with a 6-digit emailed code — no
passwords, no magic links. An address without an account cannot sign itself up
(`shouldCreateUser: false`), which is how sign-in stays limited to staff; see
[`auth.md`](auth.md). Everyone else sends a share token in an
`x-share-token` header, validated in RLS by `app.request_token()` — a header, not
a query param, so it stays out of Postgres logs and `Referer`.

- **Inbox** (`/inbox/:token`) — a partner may insert `tracks` into that one
  inbox, and read the one project it belongs to. They **cannot read tracks
  back**, so one partner cannot enumerate another's submissions.
- **Playlist** (`/p/:token`) — a client may read that playlist's tracks and
  write comments.

## Upload path

Browser asks `sign-upload` for a presigned PUT → uploads straight to S3 →
*then* inserts the `tracks` row. Files never pass through Supabase, the frontend
holds no AWS config, the caller never chooses the S3 key (the function mints the
uuid and the `tracks/{uuid}/original.{ext}` path), and a failed upload leaves no
orphan row.

## The inbox page, in one paragraph

Partners drop 20–50 files at once and **will not fill in forms**. So: one
dropzone taking files or whole folders, a row per file, no per-track inputs, one
optional note for the batch, four uploads in parallel with per-file progress and
retry. Titles and tags (artist, album, BPM, key, duration) are read from the
files in the browser as a fast first pass, falling back to a tidied filename.
Identity — name, email, company — is captured once per browser and attached to
every row. Staff correct metadata later in the library; partners never do.

## Principles worth knowing

- **The Lambda owns metadata truth.** Browser tag reads are a convenience; the
  server re-reads the file. Never make an upload depend on a browser tag read.
- **Nothing blocks an upload on a guess.** Duplicate detection is advisory at
  every layer, because losing a track that belonged is worse than storing one
  twice.
- **Brand values are read from the Webflow site, not chosen.** Sequel Brown
  `#372b29` for every line, Sequel Silver `#f1f0ee` ground, zero border radius
  anywhere, Creato Display with no fallback, Azeret Mono for buttons, Fahkwang
  for the project title. All fonts self-hosted.
- **Internal fields stay off partner-facing pages.**

## Current state

Working: the bulk inbox end to end (presign → S3 → row, verified against live
data), browser tag extraction including BPM, per-browser duplicate flagging,
the full brand pass.

Outstanding:

1. **Staff sign-in works.** Accounts exist, Resend SMTP is live, and sign-ins
   are recorded in the auth logs. [`auth.md`](auth.md) has the settings.
2. `xano-webhook` is deployed but **inert until two secrets are set** in the
   Supabase dashboard: `XANO_WEBHOOK_SECRET` and `APP_BASE_URL`. Until then
   every call returns 500 naming what is missing. Contract in
   [`xano-sync.md`](xano-sync.md).
3. The Lambda's `content_hash` / `duplicate_of` work is **not started**; the
   columns and indexes exist, nothing writes them.
4. Open question: library tags whose "title" is a paragraph of sales copy.


## Map

```
src/routes/Inbox.tsx     the bulk drop page
src/lib/                 dropFiles, filename, tags, partner, sentFiles,
                         uploadQueue, upload, tokenClient
supabase/migrations/     0001 init · 0002 lock triggers
                         0003 submitter + tags · 0004 content hash
supabase/functions/      sign-upload · xano-webhook
docs/                    architecture · auth · decisions · gotchas · xano-sync
```
