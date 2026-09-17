-- The Schedule A is signed on Sequel's own page, not through Firma — Andy,
-- 16 Sep 2026, after trying Firma's embedded signing (slow, its own terms to
-- accept, its own styling inside a frame, and a long wait after signing).
--
-- The composer sees the Schedule A, types their full name, ticks a consent
-- box and presses Sign. The edge function stamps the name onto the PDF, adds a
-- signature record page, keeps the file, and emails a copy. What makes the
-- signature stand up is the record kept here: who, when, from where, and
-- exactly which details they were shown.
--
-- schedule_a_via: 'sequel' for new songs. The two Firma test songs keep
-- 'firma'; the firma_* columns stay for them and are unused from now on.

alter table xano_mirror.sequel_songs
  add column if not exists schedule_a_signer_ip text,
  add column if not exists schedule_a_signer_agent text,
  add column if not exists schedule_a_consent text,
  add column if not exists schedule_a_details_sha256 text,
  add column if not exists schedule_a_pdf_sha256 text,
  add column if not exists signed_copy_emailed_at timestamptz,
  add column if not exists signed_copy_email_error text;

comment on column xano_mirror.sequel_songs.schedule_a_signer_ip is
  'The IP address the Schedule A was signed from, as the edge function saw it.';
comment on column xano_mirror.sequel_songs.schedule_a_signer_agent is
  'The signer''s browser (user agent) at signing.';
comment on column xano_mirror.sequel_songs.schedule_a_consent is
  'The exact consent wording the signer ticked.';
comment on column xano_mirror.sequel_songs.schedule_a_details_sha256 is
  'SHA-256 of the Schedule A details as shown to the signer. The page sends back the hash it was shown; a mismatch refuses the signature.';
comment on column xano_mirror.sequel_songs.schedule_a_pdf_sha256 is
  'SHA-256 of the signed PDF as stored, so the file can be shown to be unaltered.';
comment on column xano_mirror.sequel_songs.schedule_a_via is
  '''sequel'' (signed on the confirmation page) for songs created in the new app; ''firma'' for the two Firma test songs of 16 Sep 2026. Null: an older song, signed through BoldSign.';

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
    'sequel', v_email, true
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
