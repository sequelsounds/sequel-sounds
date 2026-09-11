-- 0003 — bulk drops: partner identity per row, plus the tag fields the browser
-- reads on the way in. All nullable: the Lambda re-reads tags server-side and
-- is the authoritative writer, so an empty column here is normal, not an error.

alter table public.tracks
  add column if not exists submitter_name    text,
  add column if not exists submitter_email   text,
  add column if not exists submitter_company text,
  add column if not exists album             text,
  add column if not exists bpm               numeric(6, 2),
  add column if not exists musical_key       text;

comment on column public.tracks.submitter_name is
  'Self-declared partner identity, captured once per browser. Not verified — the share token is the only real authorisation.';
comment on column public.tracks.bpm is
  'First-pass value from browser-side tags. The ffmpeg Lambda overwrites with its own read.';
comment on column public.tracks.musical_key is
  'Musical key from tags (e.g. "Am"). Named to avoid confusion with s3_key / preview_key.';

-- Staff filter the inbox by who sent the drop.
create index if not exists tracks_submitter_email_idx
  on public.tracks (project_id, submitter_email);
