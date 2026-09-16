-- Songs made in the new app were being deleted by the hourly Xano sync
-- (found 16 Sep 2026, evening: test song 1001, its two writers and its new
-- writer record were all gone within the hour). The sync's `full` push deletes
-- every mirror row whose id Xano did not send, and Xano never hears about a
-- song created here.
--
-- Fix: rows the app creates are marked `app_created`, and xano-mirror-sync
-- only deletes rows where it is false. Xano's upserts never send the column,
-- so they cannot clear it, and a new Xano row takes the default (false).
--
-- ⚠️ New app rows start at id 1000 (0030). Xano's own ids are far below that
-- today; if Xano ever reaches 1000 in these tables its upsert would overwrite
-- an app row. Moot once these tables leave the sync at cutover.

alter table xano_mirror.sequel_songs       add column if not exists app_created boolean not null default false;
alter table xano_mirror.sequel_song_writer add column if not exists app_created boolean not null default false;
alter table xano_mirror.sequel_writers     add column if not exists app_created boolean not null default false;

create or replace function public.track_create_song(
  p_project_id bigint,
  p_supplier_id bigint,
  p_ownership text default 'Master & Publishing'
)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_project xano_mirror.project_master_list;
  v_team    xano_mirror.supplier_list;
  v_email   text;
  v_song    xano_mirror.sequel_songs;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can create a song.' using errcode = '42501';
  end if;
  if p_ownership is null or p_ownership not in ('Master & Publishing', 'Master', 'Publishing') then
    raise exception 'Choose the rights Sequel is acquiring.' using errcode = '22023';
  end if;

  select * into v_project from xano_mirror.project_master_list p where p.id = p_project_id;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select * into v_team from xano_mirror.supplier_list s where s.id = p_supplier_id;
  if not found then
    raise exception 'Composition team not found.' using errcode = 'P0002';
  end if;
  if v_team.supplier_type is distinct from 'Composition Team' then
    raise exception 'Only a roster composition team can be sent a Schedule A.' using errcode = '22023';
  end if;
  v_email := nullif(btrim(v_team.contract_email), '');
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '% has no contract email. Add one on their roster page first.', coalesce(v_team.title, 'This team')
      using errcode = '22023';
  end if;

  insert into xano_mirror.sequel_songs (
    track_title, composer, supplier_list_id, registration_status,
    project_master_list_id, project, brand, schedule_a_status, ownership,
    status, composer_reg_form_status,
    commencement_date, commencement_date_dup2,
    schedule_a_via, contract_email, app_created
  ) values (
    'TBC', v_team.title, p_supplier_id::integer, 'Unregistered',
    p_project_id::integer, v_project.title, v_project.brand, 'Pending', p_ownership,
    'Active', 'Pending',
    to_char((now() at time zone 'Europe/London')::date, 'DD/MM/YYYY'),
    (now() at time zone 'Europe/London')::date,
    'firma', v_email, true
  )
  returning * into v_song;

  return jsonb_build_object(
    'id', v_song.id,
    'uuid', v_song.uuid,
    'contract_email', v_email,
    'team', v_team.title,
    'brand', v_project.brand,
    'project_title', v_project.title
  );
end
$function$;
revoke all on function public.track_create_song(bigint, bigint, text) from public, anon;
grant execute on function public.track_create_song(bigint, bigint, text) to authenticated;

create or replace function public.song_confirm_details(p_uuid uuid, p_title text, p_writers jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_song  xano_mirror.sequel_songs;
  v_title text := nullif(btrim(p_title), '');
  w       jsonb;
  v_name  text;
  v_cae   text;
  v_share numeric;
  v_count integer := 0;
begin
  select * into v_song from xano_mirror.sequel_songs s where s.uuid = p_uuid for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_song.composer_reg_form_status is distinct from 'Pending' then
    return jsonb_build_object('error', 'already_submitted');
  end if;
  if v_title is null then
    return jsonb_build_object('error', 'Please enter a track title.');
  end if;
  if p_writers is null or jsonb_typeof(p_writers) <> 'array' or jsonb_array_length(p_writers) = 0 then
    return jsonb_build_object('error', 'Please enter a name and share split for every composer.');
  end if;
  if jsonb_array_length(p_writers) > 20 then
    return jsonb_build_object('error', 'That is more composers than a Schedule A can hold.');
  end if;

  for w in select * from jsonb_array_elements(p_writers) loop
    v_name := nullif(btrim(w ->> 'full_name'), '');
    begin
      v_share := (w ->> 'share_split')::numeric;
    exception when others then
      v_share := null;
    end;
    if v_name is null or v_share is null or not (v_share > 0 and v_share <= 100) then
      return jsonb_build_object('error', 'Please enter a name and share split for every composer.');
    end if;
  end loop;

  update xano_mirror.sequel_songs s set
    track_title              = v_title,
    composer_reg_form_status = 'Confirmed',
    confirmed_at             = now()
  where s.id = v_song.id;

  for w in select * from jsonb_array_elements(p_writers) loop
    v_name  := btrim(w ->> 'full_name');
    v_cae   := nullif(btrim(w ->> 'cae_number'), '');
    v_share := (w ->> 'share_split')::numeric;

    insert into xano_mirror.sequel_song_writer (song_id, full_name, cae_number, share_split, created_at, app_created)
    values (v_song.id::integer, v_name, coalesce(v_cae, ''), v_share, now(), true);

    if v_cae is not null and not exists (
      select 1 from xano_mirror.sequel_writers x where lower(btrim(x.cae_number)) = lower(v_cae)
    ) then
      insert into xano_mirror.sequel_writers (cae_number, full_name, created_at, app_created)
      values (v_cae, v_name, now(), true);
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'song_id', v_song.id, 'writers', v_count);
end
$function$;
revoke all on function public.song_confirm_details(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.song_confirm_details(uuid, text, jsonb) to service_role;
