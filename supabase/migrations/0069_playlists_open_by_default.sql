-- Sign-in on playlists is dropped as a choice (Andy, 22 Sep 2026): a shared
-- playlist is an open link. Composition reviews still require sign-in, because
-- their feedback is attributed to named people — that rule is the
-- playlists_composition_requires_sign_in check and stays.
alter table public.playlists alter column require_sign_in set default false;

update public.playlists
   set require_sign_in = false
 where kind <> 'composition' and require_sign_in;
