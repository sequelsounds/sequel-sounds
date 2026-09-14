-- One way in for creating a project, by name rather than by id, so an MCP tool,
-- a form and Coda all get the same rules. SECURITY INVOKER on purpose: the insert
-- runs as the caller, so the RLS policy and the create guard apply as them.
create or replace function public.track_create_project(
  p_title             text,
  p_brand             text,
  p_product           text,
  p_campaign          text,
  p_project_type      text,
  p_country           text,
  p_client_group      text,
  p_brand_category    text,
  p_music_supervisor  text,
  p_client_agency     text    default null,
  p_service           text    default null,
  p_client_user       text    default null,
  p_adpro_user        text    default null,
  p_project_status    text    default null,
  p_concept           text    default null,
  p_notes             text    default null,
  p_proposed_air_date date    default null,
  p_pipeline_gbp      numeric default null
)
returns table (project_id bigint, project_uuid uuid, project_sequel_no text)
language plpgsql
security invoker
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $fn$
declare
  v_client   bigint; v_cat        bigint; v_supe   bigint;
  v_agency   bigint; v_service    bigint; v_cuser  bigint;
  v_adpro    bigint; v_status     bigint; v_n      int;
  v_type     text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can create projects' using errcode = 'insufficient_privilege';
  end if;

  -- project type ----------------------------------------------------------
  select t into v_type from unnest(array['Advert','Film','Social post']) t
   where lower(t) = lower(btrim(coalesce(p_project_type, '')));
  if v_type is null then
    raise exception 'Unknown project type %. Options: Advert, Film, Social post',
      coalesce(quote_literal(p_project_type), 'null') using errcode = 'check_violation';
  end if;

  -- client group ----------------------------------------------------------
  select g.id into v_client from xano_mirror.client_groups g
   where lower(btrim(g.client)) = lower(btrim(coalesce(p_client_group, '')));
  if v_client is null then
    raise exception 'Unknown client group %. Options: %',
      coalesce(quote_literal(p_client_group), 'null'),
      (select string_agg(g.client, ', ' order by g.id) from xano_mirror.client_groups g)
      using errcode = 'check_violation';
  end if;

  -- brand category --------------------------------------------------------
  select c.id into v_cat from xano_mirror.brand_category c
   where lower(btrim(c.category)) = lower(btrim(coalesce(p_brand_category, '')));
  if v_cat is null then
    raise exception 'Unknown brand category %. Options: %',
      coalesce(quote_literal(p_brand_category), 'null'),
      (select string_agg(c.category, ', ' order by c.id) from xano_mirror.brand_category c)
      using errcode = 'check_violation';
  end if;

  -- music supervisor ------------------------------------------------------
  select count(*), min(u.id) into v_n, v_supe from public.track_users u
   where u.user_type in ('Admin', 'Sequel')
     and u.status not in ('Blocked', 'Archived')
     and (lower(u.email) = lower(btrim(coalesce(p_music_supervisor, '')))
       or lower(u.full_name) = lower(btrim(coalesce(p_music_supervisor, ''))));
  if v_n = 0 then
    raise exception 'Unknown music supervisor %. Options: %',
      coalesce(quote_literal(p_music_supervisor), 'null'),
      (select string_agg(u.full_name, ', ' order by u.full_name) from public.track_users u
        where u.user_type in ('Admin','Sequel') and u.status not in ('Blocked','Archived'))
      using errcode = 'check_violation';
  elsif v_n > 1 then
    raise exception 'More than one supervisor called %. Use their email address instead',
      quote_literal(p_music_supervisor) using errcode = 'check_violation';
  end if;

  -- agency (optional) -----------------------------------------------------
  if nullif(btrim(coalesce(p_client_agency, '')), '') is not null then
    select count(*), min(c.id) into v_n, v_agency from xano_mirror.clients c
     where lower(btrim(c.company)) = lower(btrim(p_client_agency))
       and c.status is distinct from 'Archived';
    if v_n = 0 then
      raise exception 'Unknown agency %', quote_literal(p_client_agency) using errcode = 'check_violation';
    elsif v_n > 1 then
      raise exception 'More than one agency called %', quote_literal(p_client_agency) using errcode = 'check_violation';
    end if;
  end if;

  -- service (optional) ----------------------------------------------------
  if nullif(btrim(coalesce(p_service, '')), '') is not null then
    select s.id into v_service from xano_mirror.services s
     where lower(btrim(s.service)) = lower(btrim(p_service));
    if v_service is null then
      raise exception 'Unknown service %. Options: %', quote_literal(p_service),
        (select string_agg(s.service, ', ' order by s.id) from xano_mirror.services s)
        using errcode = 'check_violation';
    end if;
  end if;

  -- project status (optional, defaults to New) ----------------------------
  if nullif(btrim(coalesce(p_project_status, '')), '') is not null then
    select o.id into v_status from xano_mirror.projects_status_options o
     where lower(btrim(o.status)) = lower(btrim(p_project_status));
    if v_status is null then
      raise exception 'Unknown project status %. Options: %', quote_literal(p_project_status),
        (select string_agg(o.status, ', ' order by o.id) from xano_mirror.projects_status_options o)
        using errcode = 'check_violation';
    end if;
  end if;

  -- client contact / ad producer (optional) -------------------------------
  if nullif(btrim(coalesce(p_client_user, '')), '') is not null then
    select count(*), min(u.id) into v_n, v_cuser from public.track_users u
     where u.status not in ('Blocked', 'Archived')
       and (lower(u.email) = lower(btrim(p_client_user))
         or lower(u.full_name) = lower(btrim(p_client_user)));
    if v_n = 0 then
      raise exception 'Unknown client contact %', quote_literal(p_client_user) using errcode = 'check_violation';
    elsif v_n > 1 then
      raise exception 'More than one person called %. Use their email address instead',
        quote_literal(p_client_user) using errcode = 'check_violation';
    end if;
  end if;

  if nullif(btrim(coalesce(p_adpro_user, '')), '') is not null then
    select count(*), min(u.id) into v_n, v_adpro from public.track_users u
     where u.status not in ('Blocked', 'Archived')
       and (lower(u.email) = lower(btrim(p_adpro_user))
         or lower(u.full_name) = lower(btrim(p_adpro_user)));
    if v_n = 0 then
      raise exception 'Unknown ad producer %', quote_literal(p_adpro_user) using errcode = 'check_violation';
    elsif v_n > 1 then
      raise exception 'More than one person called %. Use their email address instead',
        quote_literal(p_adpro_user) using errcode = 'check_violation';
    end if;
  end if;

  return query
  insert into xano_mirror.project_master_list (
    title, brand, product, campaignname, project_type, country,
    client, brand_category, music_supervisor,
    client_agency, services_id, client_user_id, adpro_user, projects_status,
    concept, notes, proposed_air_date, pipeline_gbp
  ) values (
    btrim(p_title), btrim(p_brand), btrim(p_product), btrim(p_campaign), v_type, btrim(p_country),
    v_client, v_cat, v_supe,
    v_agency, v_service, v_cuser, v_adpro, v_status,
    nullif(btrim(coalesce(p_concept, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    p_proposed_air_date, p_pipeline_gbp
  )
  returning xano_mirror.project_master_list.id,
            xano_mirror.project_master_list.uuid,
            xano_mirror.project_master_list.sequel_no;
end
$fn$;

revoke execute on function public.track_create_project(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,numeric) from public, anon;
grant execute on function public.track_create_project(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,numeric) to authenticated;

comment on function public.track_create_project(
  text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,numeric) is
  'Creates a project from names rather than ids. Runs as the caller, so the insert '
  'policy and the create guard decide whether it is allowed. Returns id, uuid and Sequel No.';
