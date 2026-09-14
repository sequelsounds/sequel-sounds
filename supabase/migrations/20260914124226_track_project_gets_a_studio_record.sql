-- Music, briefs and files attach to public.projects_mirror — Studio's own copy
-- of a project, which until now only the Xano webhook ever wrote. A project
-- created in Track had no row there, so it could take no uploads at all.
--
-- Only projects a person creates in Track get one. The hourly sync re-pushes
-- every Xano project and those already arrive through the webhook; letting the
-- sync through here would churn the table and mint an inbox on every run.
create or replace function xano_mirror.project_master_list_studio_record()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $fn$
declare
  v_client_name text;
begin
  if auth.uid() is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select coalesce(c.company, g.client)
      into v_client_name
      from (select 1) one
      left join xano_mirror.clients       c on c.id = new.client_agency
      left join xano_mirror.client_groups g on g.id = new.client;

    insert into public.projects_mirror (xano_id, xano_uuid, name, client_name, sequel_no, status, brief, raw)
    values (
      new.id::text, new.uuid, new.title, v_client_name, new.sequel_no, new.status,
      nullif(btrim(coalesce(new.concept, '')), ''),
      jsonb_build_object('created_in', 'track', 'project_id', new.id, 'sequel_no', new.sequel_no)
    )
    on conflict (xano_id) do nothing;

    return null;
  end if;

  -- Keep the Studio copy in step with the fields it actually shows.
  update public.projects_mirror
     set name      = new.title,
         status    = new.status,
         sequel_no = new.sequel_no,
         brief     = nullif(btrim(coalesce(new.concept, '')), ''),
         synced_at = now()
   where xano_id = new.id::text
     and (name is distinct from new.title
       or status is distinct from new.status
       or sequel_no is distinct from new.sequel_no);

  return null;
end
$fn$;

drop trigger if exists project_master_list_studio_record on xano_mirror.project_master_list;
create trigger project_master_list_studio_record
  after insert or update on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_master_list_studio_record();

comment on function xano_mirror.project_master_list_studio_record() is
  'Gives a project created in Track the public.projects_mirror row that music, '
  'briefs and file uploads attach to, and keeps its name and status in step. '
  'Skipped when auth.uid() is null so the hourly Xano sync does not churn it.';
