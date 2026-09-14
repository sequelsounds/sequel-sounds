-- Creation rules for xano_mirror.project_master_list.
--
-- NOTE: this table is STILL IN the hourly Xano sync (task 42). Anything created
-- here is deleted on the hour until the table is taken out of the sync. Every
-- rule below is therefore gated on auth.uid() being present: the sync writes as
-- service_role with no end user attached and must pass through untouched, because
-- Xano carries rows these checks would reject (14 blank stubs, zero-value FKs).

-- 1. ids of our own -------------------------------------------------------
create sequence if not exists xano_mirror.project_master_list_id_seq as bigint
  owned by xano_mirror.project_master_list.id;

select setval('xano_mirror.project_master_list_id_seq',
              greatest(1000, (select coalesce(max(id), 0) + 1
                                from xano_mirror.project_master_list)),
              false);

alter table xano_mirror.project_master_list
  alter column id set default nextval('xano_mirror.project_master_list_id_seq');

-- 2. a uuid of our own ----------------------------------------------------
-- No unique index: 17 existing rows share Xano's all-zero uuid.
alter table xano_mirror.project_master_list
  alter column uuid set default gen_random_uuid();

-- 3. audit columns --------------------------------------------------------
alter table xano_mirror.project_master_list
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by bigint;

-- 4. the guard ------------------------------------------------------------
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

  if coalesce(btrim(new.title), '')        = '' then v_missing := v_missing || 'title';          end if;
  if coalesce(btrim(new.brand), '')        = '' then v_missing := v_missing || 'brand';          end if;
  if coalesce(btrim(new.product), '')      = '' then v_missing := v_missing || 'product';        end if;
  if coalesce(btrim(new.campaignname), '') = '' then v_missing := v_missing || 'campaign name';  end if;
  if coalesce(btrim(new.project_type), '') = '' then v_missing := v_missing || 'project type';   end if;
  if coalesce(btrim(new.country), '')      = '' then v_missing := v_missing || 'country';        end if;
  if coalesce(new.client, 0)           = 0 then v_missing := v_missing || 'client group';    end if;
  if coalesce(new.brand_category, 0)   = 0 then v_missing := v_missing || 'brand category';  end if;
  if coalesce(new.music_supervisor, 0) = 0 then v_missing := v_missing || 'music supervisor'; end if;

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
  -- Counter is continuous across years and taken from the table, so it stays in
  -- step with Xano for as long as this table is still mirrored.
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

drop trigger if exists project_master_list_create_guard on xano_mirror.project_master_list;
create trigger project_master_list_create_guard
  before insert on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_master_list_create_guard();

-- 5. which columns a person may fill in -----------------------------------
-- id, uuid, sequel_no, created_at, updated_* and the Webflow/Xano plumbing are
-- deliberately absent: they are set by the database, not by the caller.
grant insert (
  title, brand, product, campaignname, project_type, country, project_currency,
  client, client_agency, brand_category, music_supervisor, services_id,
  client_user_id, adpro_user, projects_status, status, sequel_ownership,
  brand_group, concept, notesorrequest, notes, next_action, extension_yn,
  proposed_start_date, proposed_air_date, pipeline_gbp, totalbudget,
  term, territory, media, scripts, durations, cutdowns,
  proposed_artist, proposed_song
) on xano_mirror.project_master_list to authenticated;

-- 6. who may create ------------------------------------------------------
drop policy if exists project_master_list_staff_insert on xano_mirror.project_master_list;
create policy project_master_list_staff_insert
  on xano_mirror.project_master_list
  for insert to authenticated
  with check (public.track_is_staff());

comment on function xano_mirror.project_master_list_create_guard() is
  'Fills in Sequel No., uuid, created_at and the defaults, and refuses a project '
  'missing its nine required fields. Skipped entirely when auth.uid() is null so '
  'the hourly Xano sync writes unchanged.';
