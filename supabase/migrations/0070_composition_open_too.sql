-- No sign-in on any playlist, composition reviews included (Andy, 22 Sep
-- 2026). A reviewer who leaves a note is asked for their name and email the
-- first time, which is what attributes it.
alter table public.playlists drop constraint if exists playlists_composition_requires_sign_in;
update public.playlists set require_sign_in = false where require_sign_in;
