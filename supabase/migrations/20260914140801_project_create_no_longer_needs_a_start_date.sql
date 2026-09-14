-- The wizard no longer asks for a proposed start date, so creating a project no
-- longer requires one. The column stays and is still editable on the project
-- page; only the create-time check goes.
create or replace function xano_mirror.project_master_list_create_guard()
returns trigger
language plpgsql
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $fn$
declare
  v_missing text[] := '{}';
  v_counter int;
  v_brand3  text;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Never asked, always the caller — as Xano's own POST does it.
  new.music_supervisor := coalesce(nullif(new.music_supervisor, 0), public.track_user_id());

  if coalesce(btrim(new.title), '') = '' then v_missing := array_append(v_missing, 'the project title'); end if;
  if coalesce(btrim(new.brand), '') = '' then v_missing := array_append(v_missing, 'brand');             end if;
  if coalesce(new.client_user_id, 0)  = 0 then v_missing := array_append(v_missing, 'the user it is for'); end if;
  if coalesce(new.client_agency, 0)   = 0 then v_missing := array_append(v_missing, 'the client');         end if;
  if coalesce(new.services_id, 0)     = 0 then v_missing := array_append(v_missing, 'project type');       end if;
  if coalesce(new.client, 0)          = 0 then v_missing := array_append(v_missing, 'account');            end if;
  if coalesce(new.adpro_user, 0)      = 0 then v_missing := array_append(v_missing, 'AdPro lead');         end if;
  if coalesce(new.brand_category, 0)  = 0 then v_missing := array_append(v_missing, 'brand category');     end if;
  if new.music_supervisor is null then v_missing := array_append(v_missing, 'a supervisor (no Track user for this account)'); end if;
  if new.pipeline_gbp is null     then v_missing := array_append(v_missing, 'projected pipeline');         end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Cannot create project: missing %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  new.sp_id            := nullif(new.sp_id, 0);
  new.client           := nullif(new.client, 0);
  new.client_agency    := nullif(new.client_agency, 0);
  new.brand_category   := nullif(new.brand_category, 0);
  new.services_id      := nullif(new.services_id, 0);
  new.client_user_id   := nullif(new.client_user_id, 0);
  new.adpro_user       := nullif(new.adpro_user, 0);

  perform pg_advisory_xact_lock(hashtext('xano_mirror.project_master_list.sequel_no'));

  select coalesce(max((regexp_match(sequel_no, '^([0-9]+)-'))[1]::int), 0) + 1
    into v_counter
    from xano_mirror.project_master_list
   where sequel_no ~ '^[0-9]+-';

  v_brand3 := upper(substr(regexp_replace(new.brand, '[^A-Za-z]', '', 'g'), 1, 3));

  new.sequel_no := v_counter || '-' || v_brand3 || '-' || to_char(now(), 'YY') || '-II';

  new.projects_status  := coalesce(new.projects_status, 1);
  new.status           := coalesce(nullif(btrim(new.status), ''), 'Active');
  new.sequel_ownership := coalesce(nullif(btrim(new.sequel_ownership), ''), 'None');

  -- Campaign name is deliberately NOT filled in. Xano writes the literal string
  -- "CampaignName" into every new project, which is a bug, not a default.

  new.created_at      := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  new.created_at_dup2 := (now() at time zone 'utc')::date;
  new.updated_at      := now();
  new.updated_by      := public.track_user_id();

  return new;
end
$fn$;
