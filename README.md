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
