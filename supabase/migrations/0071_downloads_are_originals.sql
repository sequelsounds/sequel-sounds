-- Downloads are the files as delivered, never the compressed preview (Andy,
-- 22 Sep 2026). The "Original files too" switch is gone from the Playlister;
-- allow_originals is kept true everywhere so sign-media, which still checks
-- it, lets the original through whenever Downloads is on.
alter table public.playlists alter column allow_originals set default true;
update public.playlists set allow_originals = true where not allow_originals;
