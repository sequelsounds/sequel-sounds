# Architecture

## Shape

React 19 + TypeScript + Vite 8 SPA. Supabase for Postgres, staff auth and an
Edge Function. AWS S3 (eu-west-2) for media, with an ffmpeg Lambda that renders
previews and waveform peaks. Project and supplier records are mirrored in from
Xano.

| Piece | Where |
| --- | --- |
| Supabase project | `sveirphsppyfhulymjiu`, eu-west-2, Postgres 17.4 |
| S3 bucket | `sequel-sounds-media`, eu-west-2 |
| Edge Functions | `supabase/functions/` — `sign-upload`, `sign-media`, `xano-webhook`, `track-processed` |
| ffmpeg Lambda | `lambda/process-track` (Node 20, ffmpeg via our own layer) |
| Marketing / app site | Webflow `68e6c2e8dbcd39de2547a97d`, sequelsounds.app |

## Who can do what

Staff are the Supabase Auth users listed in the **`staff` table** — an
allowlist, since viewers become auth users too (phase 3) and "signed in" stops
meaning "staff". `app.is_staff()` reads that table. **Partners never get
accounts.** They act through a share token sent as an `x-share-token` header,
read in RLS by `app.request_token()`. The header is used rather than a query
param so the token stays out of Postgres logs and `Referer`. Viewers of a
playlist present the same header, signed in or not; a playlist with
`require_sign_in` only resolves for a signed-in request.

Two token-scoped surfaces exist: an inbox (`/inbox/:token`, insert tracks) and a
playlist (`/p/:token`, read tracks, write comments).

A partner holding an inbox token can:

- read their own `inboxes` row, and the one `projects_mirror` row it belongs to
- insert into `tracks`, only with `inbox_id` matching their token's inbox,
  `status = 'new'` and `processing_status = 'pending'`

They cannot read `tracks` back. That is deliberate — it stops one partner
enumerating another's submissions — and it is why the inbox page keeps its own
in-page record of what it sent rather than fetching one.

## Upload path

```
browser                   sign-upload (Edge)            S3                Postgres
   |  POST filename/type/size     |                      |                   |
   |----------------------------->|                      |                   |
   |         presigned PUT + uuid |                      |                   |
   |<-----------------------------|                      |                   |
   |  PUT bytes ------------------------------------->   |                   |
   |  insert tracks row ------------------------------------------------->   |
```

Three properties matter:

1. **The caller never chooses the S3 key.** `sign-upload` mints the track uuid
   and builds `tracks/{uuid}/original.{ext}` itself, so a partner cannot aim an
   upload at an existing track's prefix.
2. **Files never pass through Supabase**, and the frontend holds no AWS config.
3. **The row is written last**, so a failed upload leaves no orphan track.

The Lambda's outputs land beside the source:

```
tracks/{uuid}/original.wav    partner upload
tracks/{uuid}/preview.mp3     Lambda
tracks/{uuid}/peaks.json      Lambda
```

## Media delivery

The bucket is private. `sign-media` returns presigned GET URLs for a batch of
keys under `tracks/*` — previews, artwork, originals — after checking the
caller may see those tracks: staff see everything, a token holder sees the
tracks on that playlist (resolved by the same RLS the viewer page uses). The
browser folds all requests made within one tick into one call
(`src/lib/media.ts`), so a page of forty tracks costs one round trip.

## The staff app

`src/routes/StaffLayout.tsx` is the shell from
`docs/mockups/sequel-studio-mockup.html`: rail, workspace, Playlist Creator,
and a player spanning the bottom. The player (`lib/player.tsx`) and the
Creator's open playlist (`lib/creator.tsx`) live above the routes so neither
resets on navigation. One `DndContext` in the layout carries drags from the
inbox and library tables into the Creator; the Creator registers its drop
handler with the context rather than owning the `DndContext`, because the
draggables are in a different column.

Positions in a playlist are global (0..n-1 in render order) and rewritten in
full after every change, so "position" never has to be reconciled per section.

## The inbox page

`src/routes/Inbox.tsx` is a bulk dropzone: partners drop 20–50 files and fill in
no forms at all. Supporting modules, each deliberately small:

| Module | Job |
| --- | --- |
| `lib/dropFiles.ts` | walk dropped folders via `webkitGetAsEntry`, filter media |
| `lib/filename.ts` | filename → readable title |
| `lib/tags.ts` | `music-metadata` tag read, concurrency-capped, never throws |
| `lib/partner.ts` | submitter identity in `localStorage` |
| `lib/sentFiles.ts` | keys of files already sent, per inbox token |
| `lib/uploadQueue.ts` | fixed-concurrency runner (4 workers) |
| `lib/upload.ts` | presign call + XHR PUT with progress |

The route component is a thin wrapper rendering `<Inbox key={token} />`, so
changing inbox link rebuilds all of it. Everything on the page belongs to one
inbox.

## Metadata ownership

The browser reads ID3/RIFF/MP4 tags as a **fast first pass** so the partner can
see what they dropped. The Lambda re-reads the file server-side and is
authoritative. Title falls back to the tidied filename when the tag is empty.

Staff edit metadata later in the library. Partners never do.

## Duplicate detection

Three layers, all advisory — nothing rejects an upload:

| Layer | Catches | Status |
| --- | --- | --- |
| `localStorage`, per inbox token | same browser, survives reload | live |
| `sign-upload` filename + size, per project | other devices, other partners | live |
| Lambda SHA-256 → `content_hash` / `duplicate_of` | renames, anything else | live |

The browser never hashes: pushing a 5 GB drop through SubtleCrypto before the
first byte uploads would stall the drop it is meant to protect.

## Processing

`lambda/process-track` runs on S3 `ObjectCreated` for `tracks/*/original.*` and
is the authority on what a file is. It writes `preview.mp3` (or a 720p `mp4`),
`peaks.json` and `artwork.jpg` beside the original, reads every tag with
ffprobe, hashes the bytes, and POSTs the result to the `track-processed` Edge
Function — which is the only thing that writes to the database.

That split is deliberate: the Lambda runs arbitrary partner-supplied media
through ffmpeg, and that is the last place that should also hold a service-role
key. It has an S3 role limited to `tracks/*` and one shared secret.

**Metadata is never rewritten.** A title is the embedded title verbatim, or the
filename minus its extension. `embedded_tags` keeps the whole ffprobe dump, so
a field we have not mapped is not lost.

## Xano sync

Xano owns projects and suppliers; this app mirrors them. `xano-webhook` receives
a change and upserts on `xano_id`, then returns the project's inbox URL so Xano
can store the link it hands to partners. Upserts make retries safe. Deletes are
deliberately unsupported — tracks and playlists hang off `projects_mirror` by
foreign key and would cascade.

It is the only Edge Function with `verify_jwt` disabled: the caller is a server
holding a shared secret, and the publishable key would prove nothing. Full
contract in [`xano-sync.md`](xano-sync.md).

## Schema

`supabase/migrations/`, applied in order:

- `0001_init` — mirrors, inboxes, tracks, playlists, themes, viewers, comments,
  plus the `app` helper schema and all RLS
- `0002_lock_trigger_functions` — revoke EXECUTE on trigger functions so they
  are not published at `/rest/v1/rpc/`
- `0003_bulk_drop_submitter_and_tags` — `submitter_name/email/company`, `album`,
  `bpm`, `musical_key`
- `0004_track_content_hash_and_duplicates` — `content_hash`, `duplicate_of`
- `0005_track_metadata_from_embedded_tags` — the ffprobe columns
- `0006_studio_model` — the Studio spec: `staff` allowlist, track status
  removed, `submission_id`, sections, playlist switches, `project_assets`,
  `viewer_profiles`, `events`, `theme_presets`, `staff_project_visits`, and
  token policies opened to signed-in viewers
