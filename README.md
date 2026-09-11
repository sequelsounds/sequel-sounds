# Sequel Sounds

Internal music supervision tool. React + TypeScript + Vite, Supabase for data
and staff auth, AWS S3 (eu-west-2) for audio/video with a Lambda that renders
MP3 previews and waveform peaks.

Staff sign in with Supabase Auth. Partners and clients never get accounts —
they use share-token links, sent as an `x-share-token` header and validated in
RLS by `app.request_token()`.

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
