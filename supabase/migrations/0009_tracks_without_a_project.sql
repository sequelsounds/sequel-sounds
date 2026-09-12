-- 0009 — a track does not have to belong to a project.
--
-- `project_id` was not null in 0001, when every track arrived through an
-- inbox and every inbox belongs to a project. Staff uploading into an
-- unattached playlist breaks that assumption: there is no inbox, and no
-- project either. The spec makes unattached playlists first-class, so the
-- column follows the product rather than the product working around it.
--
-- Such a track lives in the library and in whatever playlists hold it. It is
-- in no project's inbox, which is correct — nobody sent it to one.

alter table public.tracks alter column project_id drop not null;

comment on column public.tracks.project_id is
  'The project this track was sent to, or null for a staff upload into a playlist that is not attached to one. Partner uploads always have one: the inbox insert policy requires it.';

-- The partner path is unchanged and still cannot omit it — inbox_insert
-- checks project_id against the token's inbox, and null fails that check.
