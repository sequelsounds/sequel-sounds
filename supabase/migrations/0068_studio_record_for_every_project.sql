-- Every project gets a Studio record and an upload inbox, created here in the
-- database rather than by Xano calling xano-webhook.
--
-- Why: on 22 Sep 2026 only 2 of 241 projects had a Studio record. The Xano
-- trigger that used to create them had stopped reaching xano-webhook, and Xano
-- is being switched off after the 29 Sep show and tell anyway. The 229 missing
-- records were backfilled by hand the same day (the 103 projects that already
-- had an inbox link stored in Xano kept that exact token).
--
-- This fires on any new row in xano_mirror.project_master_list, whether the
-- hourly sync brought it or the new app created it. The not-exists guard makes
-- it safe if the sync ever re-inserts rows it already had.

create or replace function xano_mirror.project_gets_studio_record()
returns trigger
language plpgsql
security definer
set search_path = public, xano_mirror, pg_catalog
as $$
begin
  if nullif(btrim(coalesce(new.sequel_no, '')), '') is null then
    return new;  -- blank stub rows from Xano get nothing
  end if;
  if exists (select 1 from public.projects_mirror where xano_id = new.id::text) then
    return new;
  end if;

  insert into public.projects_mirror (xano_id, xano_uuid, name, sequel_no, client_name, status, raw)
  values (
    new.id::text,
    nullif(new.uuid, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(nullif(btrim(new.title), ''), new.sequel_no),
    new.sequel_no,
    (select company from xano_mirror.clients where id = new.client_agency),
    'Active',
    jsonb_build_object('created_by', 'project_gets_studio_record')
  );
  -- The inbox comes from projects_mirror_create_inbox on that insert.
  return new;
end;
$$;

revoke all on function xano_mirror.project_gets_studio_record() from public, anon, authenticated;

drop trigger if exists project_gets_studio_record on xano_mirror.project_master_list;
create trigger project_gets_studio_record
  after insert on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_gets_studio_record();
