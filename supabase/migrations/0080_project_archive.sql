-- 23 Sep 2026. Share and delete on the /projects rows, as the old app has them.
--
-- Delete archives, as the old app's archive_project does: Project Master List's
-- `status` becomes 'Archived' and the project leaves the list. Its quotes,
-- invoices, contracts, assets and songs are untouched.
--
-- project_master_list is still pushed from Xano every hour, and Xano would send
-- the project back as Active. The guard below keeps an archive made here: the
-- sync (service role) cannot un-archive a row. The old app has no un-archive,
-- so nothing legitimate is lost.

create or replace function public.track_archive_project(p_project_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can delete a project.' using errcode = '42501';
  end if;

  update xano_mirror.project_master_list p
     set status = 'Archived'
   where p.id = p_project_id;

  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
end
$function$;

revoke all on function public.track_archive_project(bigint) from public, anon;
grant execute on function public.track_archive_project(bigint) to authenticated;

create or replace function xano_mirror.project_keep_archive()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
  if coalesce(auth.role(), '') = 'service_role' and old.status = 'Archived' then
    new.status := 'Archived';
  end if;
  return new;
end
$fn$;

drop trigger if exists project_keep_archive on xano_mirror.project_master_list;
create trigger project_keep_archive
  before update on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_keep_archive();
