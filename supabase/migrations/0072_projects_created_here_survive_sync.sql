-- Projects created in the new app were being deleted by the hourly Xano sync.
-- Found 23 Sep 2026: the Coda write test made project 1011; ids 1000–1010,
-- earlier app-created projects, were already gone. The sync's `full` push
-- deletes every mirror row Xano did not send unless the table carries
-- `app_created` — the pattern users, songs, invoices, briefs and contracts use.
--
-- The sync writes with the service role; everything the app or Coda inserts
-- runs as a signed-in person. So an insert that is not the service role is
-- ours, and is marked. Xano's upserts never send the column, so they cannot
-- clear it.

alter table xano_mirror.project_master_list
  add column if not exists app_created boolean not null default false;

comment on column xano_mirror.project_master_list.app_created is
  'True for a project this app created. The hourly Xano sync only deletes rows
   where this is false, so it is what keeps a new project alive past the hour.';

create or replace function xano_mirror.project_mark_app_created()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.app_created := true;
  end if;
  return new;
end
$fn$;

drop trigger if exists project_mark_app_created on xano_mirror.project_master_list;
create trigger project_mark_app_created
  before insert on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_mark_app_created();

-- The one app-created project that has survived so far.
update xano_mirror.project_master_list set app_created = true where id >= 1000;
