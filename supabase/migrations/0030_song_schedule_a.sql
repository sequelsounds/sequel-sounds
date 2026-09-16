-- Song confirmation and the Schedule A, as one flow — Andy, 16 Sep 2026.
--
-- Applied through the MCP on 16 Sep as two remote entries (0030_song_schedule_a
-- and 0030b_song_signing_link_and_error, the last two columns); this file is
-- their combined final state, with the reasoning the database did not record.
--
-- The old app did this in two halves: Xano made the song and emailed the
-- composer a form (New_song + table trigger 11 + confirm_song_writers), and the
-- Schedule A went out separately through SharePoint and BoldSign. Here the
-- composer confirms the details and signs the Schedule A on the same page, and
-- the signing is done by Firma (firma.dev) instead of BoldSign.
--
-- Decisions behind this file (Andy, 16 Sep):
--   * the song is created from inside a project: team + rights + confirm;
--   * rights are Master / Publishing / Master & Publishing (the default);
--   * the Schedule A goes to, and is signed by, the supplier's CONTRACT email,
--     a new field on every supplier, copied from Brief Email for the roster;
--   * CAE is optional — some composers have none;
--   * a share total other than 100% warns but never blocks;
--   * the writers are kept as rows as well as on the contract, for PRS later.
--
-- ⚠️ sequel_songs, sequel_song_writer and sequel_writers are all still in the
-- hourly Xano sync (task 42). A song made here is test data until the cutover:
-- a full push removes rows Xano does not have. The cascade below is so that a
-- push removing a song cannot fail on the writer rows that point at it.

-- ------------------------------------------------------------ contract email
alter table xano_mirror.supplier_list add column if not exists contract_email text;
comment on column xano_mirror.supplier_list.contract_email is
  'Who receives and signs contracts (the Schedule A). New in the new app, 16 Sep 2026; seeded from brief_email for composition teams.';

update xano_mirror.supplier_list
   set contract_email = nullif(btrim(brief_email), '')
 where supplier_type = 'Composition Team'
   and contract_email is null;

grant update (contract_email) on xano_mirror.supplier_list to authenticated;
grant insert (contract_email) on xano_mirror.supplier_list to authenticated;

-- ------------------------------------------------------------- ids and uuids
-- Mirror traps 1 and 2: no default on id or uuid. Sequences start at 1000,
-- well clear of Xano's own counters, as for quotes, projects and invoices.
create sequence if not exists xano_mirror.sequel_songs_id_seq start with 1000;
alter table xano_mirror.sequel_songs alter column id set default nextval('xano_mirror.sequel_songs_id_seq');
alter sequence xano_mirror.sequel_songs_id_seq owned by xano_mirror.sequel_songs.id;
alter table xano_mirror.sequel_songs alter column uuid set default gen_random_uuid();

create sequence if not exists xano_mirror.sequel_song_writer_id_seq start with 1000;
alter table xano_mirror.sequel_song_writer alter column id set default nextval('xano_mirror.sequel_song_writer_id_seq');
alter sequence xano_mirror.sequel_song_writer_id_seq owned by xano_mirror.sequel_song_writer.id;

create sequence if not exists xano_mirror.sequel_writers_id_seq start with 1000;
alter table xano_mirror.sequel_writers alter column id set default nextval('xano_mirror.sequel_writers_id_seq');
alter sequence xano_mirror.sequel_writers_id_seq owned by xano_mirror.sequel_writers.id;
alter table xano_mirror.sequel_writers alter column writer_uuid set default gen_random_uuid();

-- A song removed (by the sync, or later by staff) takes its writer rows with it.
do $$
declare v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'xano_mirror.sequel_song_writer'::regclass
     and c.confrelid = 'xano_mirror.sequel_songs'::regclass
     and c.contype = 'f';
  if v_name is not null then
    execute format('alter table xano_mirror.sequel_song_writer drop constraint %I', v_name);
  end if;
end $$;
alter table xano_mirror.sequel_song_writer
  add constraint sequel_song_writer_song_id_fkey
  foreign key (song_id) references xano_mirror.sequel_songs (id) on delete cascade;

-- --------------------------------------------------------- signing columns
-- Xano never sends these, and the sync leaves columns it does not send alone.
alter table xano_mirror.sequel_songs
  add column if not exists schedule_a_via text,
  add column if not exists contract_email text,
  add column if not exists link_emailed_at timestamptz,
  add column if not exists link_email_error text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists firma_request_id text,
  add column if not exists firma_signer_id text,
  add column if not exists schedule_a_sent_at timestamptz,
  add column if not exists schedule_a_signed_at timestamptz,
  add column if not exists schedule_a_signer_name text,
  add column if not exists schedule_a_pdf_path text,
  add column if not exists firma_signing_url text,
  add column if not exists firma_error text;

comment on column xano_mirror.sequel_songs.schedule_a_via is
  '''firma'' for songs created in the new app. Only these are signed through the confirmation page; older songs went through BoldSign.';
comment on column xano_mirror.sequel_songs.contract_email is
  'The supplier''s contract email at the moment the song was created — who the link went to and who signs.';
comment on column xano_mirror.sequel_songs.firma_error is
  'The last thing that went wrong preparing or finishing the Schedule A, for staff. Cleared on success.';
comment on column xano_mirror.sequel_songs.schedule_a_pdf_path is
  'The signed Schedule A in the private storage bucket schedule-a.';

-- ---------------------------------------------------------- signed copies
insert into storage.buckets (id, name, public)
values ('schedule-a', 'schedule-a', false)
on conflict (id) do nothing;

-- ----------------------------------------------------- track_create_song
-- + NEW SONG on a project: New_song, with the checks the old modal made in the
-- browser (a team and rights both picked) made here instead, plus the two the
-- flow now depends on — the team is a roster team, and it has a contract email.
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
    schedule_a_via, contract_email
  ) values (
    'TBC', v_team.title, p_supplier_id::integer, 'Unregistered',
    p_project_id::integer, v_project.title, v_project.brand, 'Pending', p_ownership,
    'Active', 'Pending',
    to_char((now() at time zone 'Europe/London')::date, 'DD/MM/YYYY'),
    (now() at time zone 'Europe/London')::date,
    'firma', v_email
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

-- ------------------------------------------------- song_confirm_details
-- confirm_song_writers, but in one transaction: the old endpoint marked the
-- song Confirmed before adding the writers, so a failed insert left it
-- Confirmed with some of them missing. Called by the song-schedule-a edge
-- function only (service role) — it is where the uuid is checked and where the
-- signing starts, so the browser never calls this directly.
--
-- Each writer with a CAE is also recorded once in sequel_writers (matched on
-- the CAE, first spelling kept), which is the list PRS registration will read.
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

  -- Check them all before writing any.
  for w in select * from jsonb_array_elements(p_writers) loop
    v_name := nullif(btrim(w ->> 'full_name'), '');
    begin
      v_share := (w ->> 'share_split')::numeric;
    exception when others then
      v_share := null;
    end;
    if v_name is null or v_share is null or v_share <= 0 then
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

    insert into xano_mirror.sequel_song_writer (song_id, full_name, cae_number, share_split, created_at)
    values (v_song.id::integer, v_name, coalesce(v_cae, ''), v_share, now());

    if v_cae is not null and not exists (
      select 1 from xano_mirror.sequel_writers x where lower(btrim(x.cae_number)) = lower(v_cae)
    ) then
      insert into xano_mirror.sequel_writers (cae_number, full_name, created_at)
      values (v_cae, v_name, now());
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'song_id', v_song.id, 'writers', v_count);
end
$function$;
revoke all on function public.song_confirm_details(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.song_confirm_details(uuid, text, jsonb) to service_role;
