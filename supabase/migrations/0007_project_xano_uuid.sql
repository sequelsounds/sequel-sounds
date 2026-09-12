-- 0007 — Track's project page is keyed by the project's UUID (the Project
-- Master List's UUID column), not by its numeric id. The mirror keeps both:
-- `xano_id` stays the upsert key; `xano_uuid` is what "Open in Track" needs.

alter table public.projects_mirror add column xano_uuid uuid;

create unique index projects_mirror_xano_uuid_idx
  on public.projects_mirror (xano_uuid) where xano_uuid is not null;

comment on column public.projects_mirror.xano_uuid is
  'The Project Master List UUID in Xano. Builds https://www.sequelsounds.app/project?uuid=… for Open in Track.';
