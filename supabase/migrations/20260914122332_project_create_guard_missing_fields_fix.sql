-- text[] || 'literal' is ambiguous (Postgres tries array_cat), so the
-- missing-field message raised 22P02 instead of naming the missing fields.
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
  -- the hourly sync, and anything else running without an end user, passes through
  if auth.uid() is null then
    return new;
  end if;

  if coalesce(btrim(new.title), '')        = '' then v_missing := array_append(v_missing, 'title');            end if;
  if coalesce(btrim(new.brand), '')        = '' then v_missing := array_append(v_missing, 'brand');            end if;
  if coalesce(btrim(new.product), '')      = '' then v_missing := array_append(v_missing, 'product');          end if;
  if coalesce(btrim(new.campaignname), '') = '' then v_missing := array_append(v_missing, 'campaign name');    end if;
  if coalesce(btrim(new.project_type), '') = '' then v_missing := array_append(v_missing, 'project type');     end if;
  if coalesce(btrim(new.country), '')      = '' then v_missing := array_append(v_missing, 'country');          end if;
  if coalesce(new.client, 0)           = 0 then v_missing := array_append(v_missing, 'client group');      end if;
  if coalesce(new.brand_category, 0)   = 0 then v_missing := array_append(v_missing, 'brand category');    end if;
  if coalesce(new.music_supervisor, 0) = 0 then v_missing := array_append(v_missing, 'music supervisor');  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Cannot create project: missing %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  -- Xano's zero-means-null, on the way in
  new.sp_id            := nullif(new.sp_id, 0);
  new.client           := nullif(new.client, 0);
  new.client_agency    := nullif(new.client_agency, 0);
  new.brand_category   := nullif(new.brand_category, 0);
  new.music_supervisor := nullif(new.music_supervisor, 0);
  new.services_id      := nullif(new.services_id, 0);
  new.client_user_id   := nullif(new.client_user_id, 0);
  new.adpro_user       := nullif(new.adpro_user, 0);

  -- Sequel No. is ours to allocate, never the caller's to choose.
  perform pg_advisory_xact_lock(hashtext('xano_mirror.project_master_list.sequel_no'));

  select coalesce(max((regexp_match(sequel_no, '^([0-9]+)-'))[1]::int), 0) + 1
    into v_counter
    from xano_mirror.project_master_list
   where sequel_no ~ '^[0-9]+-';

  v_brand3 := upper(substr(regexp_replace(new.brand, '[^A-Za-z]', '', 'g'), 1, 3));

  new.sequel_no := v_counter || '-' || v_brand3 || '-' || to_char(now(), 'YY') || '-II';

  new.projects_status  := coalesce(new.projects_status, 1);            -- New
  new.status           := coalesce(nullif(btrim(new.status), ''), 'Active');
  new.sequel_ownership := coalesce(nullif(btrim(new.sequel_ownership), ''), 'None');

  new.created_at      := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  new.created_at_dup2 := (now() at time zone 'utc')::date;
  new.updated_at      := now();
  new.updated_by      := public.track_user_id();

  return new;
end
$fn$;
