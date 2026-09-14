drop function if exists public.track_create_project(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,numeric);

-- Creating a project from names rather than ids, for callers that only have
-- words. The fields are Track's New Project wizard, in its order and using its
-- own labels — "Project Type" is the service, "Account" is the client group,
-- "Client" is the agency. Those names are inconsistent with the project page,
-- which calls the same three Service, Client and Agency, but they are what
-- staff are asked today and renaming them here would be a third vocabulary.
--
-- SECURITY INVOKER on purpose: the insert runs as the caller, so the policy and
-- the create guard decide whether it is allowed.
create or replace function public.track_create_project(
  p_title               text,
  p_brand               text,
  p_client_user         text,
  p_client              text,
  p_project_type        text,
  p_pipeline_gbp        numeric,
  p_proposed_start_date text,
  p_account             text,
  p_adpro_lead          text,
  p_brand_category      text,
  p_client_job_no       text default null
)
returns table (project_id bigint, project_uuid uuid, project_sequel_no text)
language plpgsql
security invoker
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $fn$
declare
  v_user bigint; v_agency bigint; v_service bigint;
  v_account bigint; v_adpro bigint; v_cat bigint; v_n int;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can create projects' using errcode = 'insufficient_privilege';
  end if;

  -- 1. which user is this project for
  select count(*), min(u.id) into v_n, v_user from public.track_users u
   where u.user_type in ('Agency', 'Brand', 'Freelance')
     and u.status not in ('Blocked', 'Archived')
     and (lower(u.email) = lower(btrim(coalesce(p_client_user, '')))
       or lower(u.full_name) = lower(btrim(coalesce(p_client_user, ''))));
  if v_n = 0 then
    raise exception 'No user found for %', coalesce(quote_literal(p_client_user), 'null')
      using errcode = 'check_violation';
  elsif v_n > 1 then
    raise exception 'More than one user called %. Use their email address instead',
      quote_literal(p_client_user) using errcode = 'check_violation';
  end if;

  -- 4. and the client (the agency)
  select count(*), min(c.id) into v_n, v_agency from xano_mirror.clients c
   where lower(btrim(c.company)) = lower(btrim(coalesce(p_client, '')))
     and c.status is distinct from 'Archived';
  if v_n = 0 then
    raise exception 'No client found for %', coalesce(quote_literal(p_client), 'null')
      using errcode = 'check_violation';
  elsif v_n > 1 then
    raise exception 'More than one client called %', quote_literal(p_client)
      using errcode = 'check_violation';
  end if;

  -- 6. project type (the service)
  select s.id into v_service from xano_mirror.services s
   where lower(btrim(s.service)) = lower(btrim(coalesce(p_project_type, '')));
  if v_service is null then
    raise exception 'Unknown project type %. Options: %',
      coalesce(quote_literal(p_project_type), 'null'),
      (select string_agg(s.service, ', ' order by s.id) from xano_mirror.services s)
      using errcode = 'check_violation';
  end if;

  -- 9. account (the client group)
  select g.id into v_account from xano_mirror.client_groups g
   where lower(btrim(g.client)) = lower(btrim(coalesce(p_account, '')));
  if v_account is null then
    raise exception 'Unknown account %. Options: %',
      coalesce(quote_literal(p_account), 'null'),
      (select string_agg(g.client, ', ' order by g.id) from xano_mirror.client_groups g)
      using errcode = 'check_violation';
  end if;

  -- 10. AdPro lead
  select count(*), min(u.id) into v_n, v_adpro from public.track_users u
   where u.user_type = 'Adpro'
     and u.status not in ('Blocked', 'Archived')
     and (lower(u.email) = lower(btrim(coalesce(p_adpro_lead, '')))
       or lower(u.full_name) = lower(btrim(coalesce(p_adpro_lead, ''))));
  if v_n = 0 then
    raise exception 'No AdPro lead found for %. Options: %',
      coalesce(quote_literal(p_adpro_lead), 'null'),
      (select string_agg(u.full_name, ', ' order by u.full_name) from public.track_users u
        where u.user_type = 'Adpro' and u.status not in ('Blocked','Archived'))
      using errcode = 'check_violation';
  elsif v_n > 1 then
    raise exception 'More than one AdPro lead called %. Use their email address instead',
      quote_literal(p_adpro_lead) using errcode = 'check_violation';
  end if;

  -- 11. brand category
  select c.id into v_cat from xano_mirror.brand_category c
   where lower(btrim(c.category)) = lower(btrim(coalesce(p_brand_category, '')));
  if v_cat is null then
    raise exception 'Unknown brand category %. Options: %',
      coalesce(quote_literal(p_brand_category), 'null'),
      (select string_agg(c.category, ', ' order by c.id) from xano_mirror.brand_category c)
      using errcode = 'check_violation';
  end if;

  return query
  insert into xano_mirror.project_master_list (
    title, brand, client_user_id, client_agency, services_id,
    pipeline_gbp, proposed_start_date, client, adpro_user, brand_category, brand_no
  ) values (
    btrim(p_title), btrim(p_brand), v_user, v_agency, v_service,
    p_pipeline_gbp, btrim(coalesce(p_proposed_start_date, '')), v_account, v_adpro, v_cat,
    nullif(btrim(coalesce(p_client_job_no, '')), '')
  )
  returning xano_mirror.project_master_list.id,
            xano_mirror.project_master_list.uuid,
            xano_mirror.project_master_list.sequel_no;
end
$fn$;

revoke execute on function public.track_create_project(
  text,text,text,text,text,numeric,text,text,text,text,text) from public, anon;
grant execute on function public.track_create_project(
  text,text,text,text,text,numeric,text,text,text,text,text) to authenticated;
