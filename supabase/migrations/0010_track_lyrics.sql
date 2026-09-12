-- 0010 — lyrics.
--
-- The spec listed lyrics as out of scope; they were asked for, so they are in
-- scope now and docs/product-spec.md says so. One nullable text column: staff
-- type them, nothing parses them, and the ffmpeg Lambda does not touch them —
-- an embedded USLT frame is not something production libraries fill in, and
-- overwriting a typed lyric with an empty tag read would be worse than having
-- no column at all.

alter table public.tracks add column lyrics text;

comment on column public.tracks.lyrics is
  'Typed by staff. Never written by the Lambda: a tag read that came back empty would wipe what someone entered.';
