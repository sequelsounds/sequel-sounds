-- 0053_signature_kind
--
-- A signature can now be made two ways — drawn with a pointer, or typed in a
-- handwriting face (Andy, 19 Sep). Both store an SVG path in the same 600x200
-- box, so almost nothing downstream cares which. One thing does.
--
-- ⚠️ A DRAWN SIGNATURE IS A LINE; A TYPED ONE IS A SHAPE. The first is stroked
-- when it goes onto a page, the second is filled. Get it the wrong way round
-- and a drawn signature fills every loop in the handwriting into a blob, while
-- a typed one gets traced round the edge of each letter twice and reads as a
-- font rather than a signature. Hence this column: the path alone does not say
-- which it is.
--
-- It is snapshotted onto the release form beside the path, for the same reason
-- the path is — the letter keeps the signature it went out with.

alter table public.track_users
  add column if not exists signature_kind text not null default 'drawn';
alter table public.track_users drop constraint if exists track_users_signature_kind_ck;
alter table public.track_users add constraint track_users_signature_kind_ck
  check (signature_kind in ('drawn', 'typed'));

alter table public.track_release_forms
  add column if not exists signer_signature_kind text not null default 'drawn';

comment on column public.track_users.signature_kind is
  'drawn = a stroke, stroked when drawn onto a page. typed = letter outlines, filled. Filling a stroke turns every loop into a blob; stroking outlines traces round each letter twice.';

-- ⚠️ The cap goes to 200 000: letter outlines are curves, and a typed name runs
-- an order of magnitude longer than a hand-drawn scrawl.
create or replace function public.track_save_my_signature(p_path text, p_kind text default 'drawn')
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v text := nullif(btrim(coalesce(p_path, '')), '');
  k text := lower(btrim(coalesce(p_kind, 'drawn')));
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if k not in ('drawn', 'typed') then
    raise exception 'Unknown signature kind.' using errcode = '22023';
  end if;
  if v is not null then
    if length(v) > 200000 then
      raise exception 'That signature is too long to store.' using errcode = '22023';
    end if;
    if v !~ '^[Mm]' or v ~ '[^MmLlCcQqZzHhVvSsTtAa0-9eE ,.+-]' then
      raise exception 'That does not look like a signature.' using errcode = '22023';
    end if;
  end if;
  update public.track_users
     set signature_path = v,
         signature_kind = k,
         signature_updated_at = case when v is null then null else now() end
   where auth_user_id = auth.uid();
  if not found then
    raise exception 'You have no user record.' using errcode = 'P0002';
  end if;
end
$function$;

-- ⚠️ The one-argument version goes, or PostgREST has two to choose between and
-- a save without a kind lands silently on the old one — which would store a
-- typed signature and leave it marked as drawn.
drop function if exists public.track_save_my_signature(text);

create or replace function public.track_my_signature()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare u public.track_users%rowtype;
begin
  select * into u from public.track_users where auth_user_id = auth.uid();
  if not found then
    raise exception 'You have no user record.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', u.id,
    'signature_path', u.signature_path,
    'signature_kind', u.signature_kind,
    'signature_updated_at', u.signature_updated_at);
end
$function$;

revoke all on function public.track_save_my_signature(text, text) from public, anon;
grant execute on function public.track_save_my_signature(text, text) to authenticated;

-- Create and update recreated once more, to carry the kind alongside the path.
-- Bodies otherwise identical to 0052; see 0049 and 0051 for the reasoning on
-- the validation loop, the key and the snapshot.

create or replace function public.track_create_release_form(
  p_project_id bigint, p_recipient_name text, p_recipient_address text, p_brand text,
  p_campaign text, p_track_name text, p_term text, p_territory text, p_media text,
  p_scripts text, p_recipient_email text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog' as $function$
declare
  v_uuid uuid := gen_random_uuid();
  v_me public.track_users%rowtype;
  v_key text; v_id bigint; v_req text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can issue release forms.' using errcode = '42501';
  end if;
  select * into v_me from public.track_users where auth_user_id = auth.uid();
  if v_me.full_name is null or btrim(v_me.full_name) = '' then
    raise exception 'Your user record has no name, so nothing could be signed.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from xano_mirror.project_master_list p where p.id = p_project_id) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  foreach v_req in array array['recipient name','brand','campaign','track','term','territory','media','scripts']
  loop
    if btrim(coalesce(case v_req
        when 'recipient name' then p_recipient_name when 'brand' then p_brand
        when 'campaign' then p_campaign when 'track' then p_track_name
        when 'term' then p_term when 'territory' then p_territory
        when 'media' then p_media else p_scripts end, '')) = '' then
      raise exception 'The % is needed before a release form can be issued.', v_req using errcode = '22023';
    end if;
  end loop;
  v_key := 'contracts/release-forms/' || v_uuid || '.pdf';
  insert into public.track_release_forms
    (uuid, project_master_list_id, recipient_name, recipient_address, recipient_email,
     brand, campaign, track_name, term, territory, media, scripts, signer_name,
     signer_signature, signer_signature_kind, issued_on, aws_path, file_name, created_by)
  values
    (v_uuid, p_project_id, btrim(p_recipient_name), nullif(btrim(coalesce(p_recipient_address,'')),''),
     nullif(btrim(coalesce(p_recipient_email,'')),''), btrim(p_brand), btrim(p_campaign),
     btrim(p_track_name), btrim(p_term), btrim(p_territory), btrim(p_media), btrim(p_scripts),
     btrim(v_me.full_name), v_me.signature_path, coalesce(v_me.signature_kind, 'drawn'),
     (now() at time zone 'Europe/London')::date, v_key,
     'Release Form ' || btrim(p_track_name) || '.pdf', v_me.id)
  returning id into v_id;
  return jsonb_build_object('uuid', v_uuid, 'key', v_key,
    'ref', public.track_ref('release', v_id), 'signer_name', btrim(v_me.full_name),
    'signer_signature', v_me.signature_path,
    'signer_signature_kind', coalesce(v_me.signature_kind, 'drawn'),
    'issued_on', (now() at time zone 'Europe/London')::date);
end $function$;

create or replace function public.track_update_release_form(
  p_uuid uuid, p_recipient_name text, p_recipient_address text, p_recipient_email text,
  p_brand text, p_campaign text, p_track_name text, p_term text, p_territory text,
  p_media text, p_scripts text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_catalog' as $function$
declare r public.track_release_forms%rowtype; v_req text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can change release forms.' using errcode = '42501';
  end if;
  select * into r from public.track_release_forms where uuid = p_uuid;
  if not found then raise exception 'Release form not found.' using errcode = 'P0002'; end if;
  if r.status is not distinct from 'Archived' then
    raise exception 'That release form is archived.' using errcode = '42501';
  end if;
  foreach v_req in array array['recipient name','brand','campaign','track','term','territory','media','scripts']
  loop
    if btrim(coalesce(case v_req
        when 'recipient name' then p_recipient_name when 'brand' then p_brand
        when 'campaign' then p_campaign when 'track' then p_track_name
        when 'term' then p_term when 'territory' then p_territory
        when 'media' then p_media else p_scripts end, '')) = '' then
      raise exception 'The % is needed before a release form can be issued.', v_req using errcode = '22023';
    end if;
  end loop;
  update public.track_release_forms
     set recipient_name = btrim(p_recipient_name),
         recipient_address = nullif(btrim(coalesce(p_recipient_address,'')),''),
         recipient_email = nullif(btrim(coalesce(p_recipient_email,'')),''),
         brand = btrim(p_brand), campaign = btrim(p_campaign),
         track_name = btrim(p_track_name), term = btrim(p_term),
         territory = btrim(p_territory), media = btrim(p_media), scripts = btrim(p_scripts),
         file_name = 'Release Form ' || btrim(p_track_name) || '.pdf'
   where uuid = p_uuid;
  return jsonb_build_object('uuid', r.uuid, 'key', r.aws_path,
    'ref', public.track_ref('release', r.id), 'signer_name', r.signer_name,
    'signer_signature', r.signer_signature,
    'signer_signature_kind', coalesce(r.signer_signature_kind, 'drawn'),
    'issued_on', r.issued_on);
end $function$;
