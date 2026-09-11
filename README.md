# Sequel Sounds

Internal music supervision tool. React + TypeScript + Vite, Supabase for data
and staff auth, AWS S3 (eu-west-2) for audio/video with a Lambda that renders
MP3 previews and waveform peaks.

Staff sign in with a 6-digit code emailed by Supabase Auth — no passwords. Partners and clients never get accounts —
they use share-token links, sent as an `x-share-token` header and validated in
RLS by `app.request_token()`.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — working notes for Claude in this repo
- [`docs/overview.md`](docs/overview.md) — one-page summary of the whole system
- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit
- [`docs/decisions.md`](docs/decisions.md) — why things are the way they are
- [`docs/gotchas.md`](docs/gotchas.md) — traps that cost time once
- [`docs/auth.md`](docs/auth.md) — staff sign-in, and the dashboard settings it needs
- [`docs/xano-sync.md`](docs/xano-sync.md) — the Xano → Supabase webhook contract

## Setup

```bash
npm install
cp .env.example .env   # fill in the Supabase URL and publishable key
npm run dev
```

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run lint` — oxlint
- `npm run types` — regenerate `src/lib/database.types.ts` (needs `SUPABASE_PROJECT_REF`)

## Database

Migrations live in `supabase/migrations/`. `0001_init.sql` is the core schema:
mirrors from Xano, inboxes, tracks, playlists, themes, comments and viewers,
with RLS for staff and token holders.

## File storage

Originals live in S3 `sequel-sounds-media` (eu-west-2), laid out one prefix per
track so the ffmpeg Lambda's outputs sit beside the source:

```
tracks/{track_uuid}/original.wav   partner upload
tracks/{track_uuid}/preview.mp3    Lambda
tracks/{track_uuid}/peaks.json     Lambda
```

Upload path: the browser calls the `sign-upload` Edge Function with the inbox
share token, gets a 15-minute presigned PUT, uploads straight to S3, then
inserts the track row. Files never pass through Supabase, and the frontend
holds no AWS config at all.

`sign-upload` needs these Supabase secrets (dashboard → Edge Functions →
Secrets). They are never in the repo:

- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — IAM user `sequel-sounds-signer`
- `S3_REGION` = `eu-west-2`
- `S3_BUCKET` = `sequel-sounds-media`

## Duplicate detection

The same recording arriving twice is a tidiness problem, not a failure — it
costs storage and a Lambda run, and staff see the track twice. So nothing in
this path rejects an upload. Each layer only narrows what the next one has to
look at:

| Layer | Catches | Where |
| --- | --- | --- |
| `localStorage` keys, per inbox token | a re-drop from the same browser, including after a reload | `src/lib/sentFiles.ts` |
| filename + byte length, per project | a re-drop from another device or another partner, before the bytes move | `sign-upload`, returned as `already_uploaded` |
| SHA-256 of the file | renamed copies, and anything the first two miss | the ffmpeg Lambda |

The browser never hashes. Pushing 50 files through SubtleCrypto before the
first byte uploads would stall the drop it is meant to protect, and the answer
would still only be as good as one browser's memory.

**The Lambda owes two things** (its source lives outside this repo):

1. Write `tracks.content_hash` — the SHA-256 of the original it has already
   downloaded to render the preview. No extra read.
2. If another track in the same `project_id` already carries that hash, set
   `tracks.duplicate_of` to the *earliest* such track.

Both columns are advisory. There is no unique constraint, the file is kept
either way, and resolving a flagged duplicate is a staff decision in the
library — refusing an upload on a guess risks losing a track that belonged.

