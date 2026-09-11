-- 0004 — duplicate detection.
--
-- Deliberately advisory, not enforced. A duplicate is a tidiness problem, not a
-- failure: nothing breaks if the same recording arrives twice, whereas refusing
-- an upload on a guess can lose a track that should have been there. So there
-- is no unique constraint — the columns record what was found and staff decide.

alter table public.tracks
  add column if not exists content_hash text,
  add column if not exists duplicate_of uuid
    references public.tracks(id) on delete set null;

comment on column public.tracks.content_hash is
  'SHA-256 of the original file, written by the ffmpeg Lambda, which already has the bytes in hand. The browser never computes this — hashing a 5 GB drop client-side would stall the upload it is meant to protect.';
comment on column public.tracks.duplicate_of is
  'Set by the Lambda when another track in the same project shares content_hash. Advisory only: the row and its file are kept, and staff resolve it in the library.';

-- Finding an existing copy within a project is the only lookup either the
-- Lambda or sign-upload needs.
create index if not exists tracks_project_content_hash_idx
  on public.tracks (project_id, content_hash)
  where content_hash is not null;

-- sign-upload's cheap pre-check: has this project already seen this filename at
-- this exact byte length? Catches a re-drop before 42 MB moves.
create index if not exists tracks_project_filename_size_idx
  on public.tracks (project_id, original_filename, size_bytes);
