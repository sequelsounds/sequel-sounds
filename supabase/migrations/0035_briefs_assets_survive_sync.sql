-- Briefs and project assets made in the new app were still being deleted by the
-- hourly Xano sync (the 0033 fix covered songs only). Same fix: an
-- `app_created` column, which xano-mirror-sync already respects on any table
-- that has it.
--
-- Set by a trigger rather than inside each insert function, so every current
-- inserter (track_request_brief, track_create_asset, track_attach_brief_upload)
-- and any future one is covered. The sync runs as service_role with no
-- auth.uid(), so its rows keep the default (false) and its upserts never send
-- the column, so they cannot clear it.

alter table xano_mirror.briefs         add column if not exists app_created boolean not null default false;
alter table xano_mirror.project_assets add column if not exists app_created boolean not null default false;

create or replace function xano_mirror.mark_app_created()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if auth.uid() is not null then
    new.app_created := true;
  end if;
  return new;
end
$$;
revoke all on function xano_mirror.mark_app_created() from public, anon, authenticated;

drop trigger if exists briefs_mark_app_created on xano_mirror.briefs;
create trigger briefs_mark_app_created
  before insert on xano_mirror.briefs
  for each row execute function xano_mirror.mark_app_created();

drop trigger if exists project_assets_mark_app_created on xano_mirror.project_assets;
create trigger project_assets_mark_app_created
  before insert on xano_mirror.project_assets
  for each row execute function xano_mirror.mark_app_created();
