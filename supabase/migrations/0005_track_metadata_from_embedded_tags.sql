-- 0005 — the metadata panel, and the tags behind it.
--
-- The ffmpeg Lambda is the authority for everything here: it has the file, so
-- it reads the tags and overwrites whatever the browser guessed on the way in.
-- Nothing in this table is rewritten or tidied — a title is the embedded title
-- verbatim, or the filename minus its extension, and nothing else.

alter table public.tracks
  add column if not exists grouping       text,
  add column if not exists genre          text,
  add column if not exists year           integer,
  add column if not exists release_date   date,
  add column if not exists isrc           text,
  add column if not exists track_no       integer,
  add column if not exists disc_no        integer,
  add column if not exists comments       text,
  add column if not exists artwork_s3_key text,
  add column if not exists pro_number     text,
  add column if not exists iswc           text,
  add column if not exists staff_notes    text,
  add column if not exists embedded_tags  jsonb;

comment on column public.tracks.embedded_tags is
  'Verbatim tag dump from ffprobe. Never normalised. The named columns are extracted from this, not instead of it.';

comment on column public.tracks.notes is
  'Written by the partner — one note for a whole drop.';
comment on column public.tracks.comments is
  'The embedded comment tag from the file itself.';
comment on column public.tracks.staff_notes is
  'Internal. Never shown to partners or clients.';

alter table public.tracks drop column if exists writers;
alter table public.tracks add column writers jsonb;

comment on column public.tracks.writers is
  'Array of {name, publisher, pro, split}. Split is a percentage; nothing here validates that the splits total 100.';

create index if not exists tracks_isrc_idx on public.tracks (isrc) where isrc is not null;
