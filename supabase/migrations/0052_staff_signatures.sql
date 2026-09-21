-- 0052_staff_signatures
--
-- A signature each staff user draws once and the app reuses — Andy, 19 Sep,
-- after noticing the release form went out unsigned while his own originals
-- carry his handwriting.
--
-- ⚠️ A PATH, NOT A PICTURE. What the pad produces is an SVG path in a 600x200
-- box: a couple of KB, sharp at any size a PDF asks for, and it drops straight
-- into pdf-lib's drawSvgPath. A PNG would need a bucket, an IAM policy, and
-- would be soft at print size.
--
-- ⚠️ IT LIVES ON `track_users`, NOT THE MIRROR. `xano_mirror."user"` is
-- overwritten by the hourly sync; anything written there is gone on the hour.
--
-- ⚠️ YOU CAN ONLY SIGN FOR YOURSELF. The write is keyed on auth.uid() and takes
-- no user argument at all, so there is no call that stamps someone else's hand
-- on a document. That is not a UI rule; it is the only shape the function has.

alter table public.track_users
  add column if not exists signature_path text,
  add column if not exists signature_updated_at timestamptz;

comment on column public.track_users.signature_path is
  'The person''s own signature, as an SVG path "d" in a 600x200 box. Not an image: a path scales into a PDF at any size and costs a couple of KB.';

alter table public.track_release_forms
  add column if not exists signer_signature text;

comment on column public.track_release_forms.signer_signature is
  'The signature AS APPLIED, copied from the issuer at create. Never refreshed: the letter carries the signature it went out with, and editing it later does not re-sign it in someone else''s hand.';

-- ⚠️ The stored path is checked, not trusted. It is rendered by drawSvgPath,
-- which takes a `d` string and nothing else, and the pattern below allows only
-- the characters a path can contain — so there is no element, no attribute and
-- no script that could ride in on it.
create or replace function public.track_save_my_signature(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v is not null then
    if length(v) > 40000 then
      raise exception 'That signature is too long to store.' using errcode = '22023';
    end if;
    if v !~ '^[Mm]' or v ~ '[^MmLlCcQqZzHhVvSsTtAa0-9eE ,.+-]' then
      raise exception 'That does not look like a signature.' using errcode = '22023';
    end if;
  end if;
  update public.track_users
     set signature_path = v,
         signature_updated_at = case when v is null then null else now() end
   where auth_user_id = auth.uid();
  if not found then
    raise exception 'You have no user record.' using errcode = 'P0002';
  end if;
end
$function$;

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
    'signature_updated_at', u.signature_updated_at);
end
$function$;

-- Create and update both recreated: create takes a snapshot of the issuer's
-- signature, and update hands back the one already stored rather than the
-- editor's — a form corrected by somebody else still bears the hand of whoever
-- issued it, because that is whose name is printed under it.
--
-- (Bodies identical to 0051 except for those two lines; see that file for the
-- reasoning on the validation loop and the key.)

create or replace function public.track_create_release_form(
  p_project_id bigint,
  p_recipient_name text,
  p_recipient_address text,
  p_brand text,
  p_campaign text,
  p_track_name text,
  p_term text,
  p_territory text,
  p_media text,
  p_scripts text,
  p_recipient_email text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $function$
declare
  v_uuid uuid := gen_random_uuid();
  v_me   public.track_users%rowtype;
  v_key  text;
  v_id   bigint;
  v_req  text;
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

  foreach v_req in array array['recipient name', 'brand', 'campaign', 'track', 'term', 'territory', 'media', 'scripts']
  loop
    if btrim(coalesce(
         case v_req
           when 'recipient name' then p_recipient_name
           when 'brand'          then p_brand
           when 'campaign'       then p_campaign
           when 'track'          then p_track_name
           when 'term'           then p_term
           when 'territory'      then p_territory
           when 'media'          then p_media
           else p_scripts
         end, '')) = '' then
      raise exception 'The % is needed before a release form can be issued.', v_req using errcode = '22023';
    end if;
  end loop;

  v_key := 'contracts/release-forms/' || v_uuid || '.pdf';

  insert into public.track_release_forms
    (uuid, project_master_list_id, recipient_name, recipient_address, recipient_email,
     brand, campaign, track_name, term, territory, media, scripts, signer_name, signer_signature,
     issued_on, aws_path, file_name, created_by)
  values
    (v_uuid, p_project_id, btrim(p_recipient_name), nullif(btrim(coalesce(p_recipient_address, '')), ''),
     nullif(btrim(coalesce(p_recipient_email, '')), ''),
     btrim(p_brand), btrim(p_campaign), btrim(p_track_name), btrim(p_term), btrim(p_territory),
     btrim(p_media), btrim(p_scripts), btrim(v_me.full_name), v_me.signature_path,
     (now() at time zone 'Europe/London')::date,
     v_key, 'Release Form ' || btrim(p_track_name) || '.pdf', v_me.id)
  returning id into v_id;

  return jsonb_build_object(
    'uuid', v_uuid,
    'key', v_key,
    'ref', public.track_ref('release', v_id),
    'signer_name', btrim(v_me.full_name),
    'signer_signature', v_me.signature_path,
    'issued_on', (now() at time zone 'Europe/London')::date);
end
$function$;

create or replace function public.track_update_release_form(
  p_uuid uuid,
  p_recipient_name text,
  p_recipient_address text,
  p_recipient_email text,
  p_brand text,
  p_campaign text,
  p_track_name text,
  p_term text,
  p_territory text,
  p_media text,
  p_scripts text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r   public.track_release_forms%rowtype;
  v_req text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can change release forms.' using errcode = '42501';
  end if;
  select * into r from public.track_release_forms where uuid = p_uuid;
  if not found then
    raise exception 'Release form not found.' using errcode = 'P0002';
  end if;
  if r.status is not distinct from 'Archived' then
    raise exception 'That release form is archived.' using errcode = '42501';
  end if;

  foreach v_req in array array['recipient name', 'brand', 'campaign', 'track', 'term', 'territory', 'media', 'scripts']
  loop
    if btrim(coalesce(
         case v_req
           when 'recipient name' then p_recipient_name
           when 'brand'          then p_brand
           when 'campaign'       then p_campaign
           when 'track'          then p_track_name
           when 'term'           then p_term
           when 'territory'      then p_territory
           when 'media'          then p_media
           else p_scripts
         end, '')) = '' then
      raise exception 'The % is needed before a release form can be issued.', v_req using errcode = '22023';
    end if;
  end loop;

  update public.track_release_forms
     set recipient_name    = btrim(p_recipient_name),
         recipient_address = nullif(btrim(coalesce(p_recipient_address, '')), ''),
         recipient_email   = nullif(btrim(coalesce(p_recipient_email, '')), ''),
         brand             = btrim(p_brand),
         campaign          = btrim(p_campaign),
         track_name        = btrim(p_track_name),
         term              = btrim(p_term),
         territory         = btrim(p_territory),
         media             = btrim(p_media),
         scripts           = btrim(p_scripts),
         file_name         = 'Release Form ' || btrim(p_track_name) || '.pdf'
   where uuid = p_uuid;

  return jsonb_build_object(
    'uuid', r.uuid,
    'key', r.aws_path,
    'ref', public.track_ref('release', r.id),
    'signer_name', r.signer_name,
    'signer_signature', r.signer_signature,
    'issued_on', r.issued_on);
end
$function$;

revoke all on function public.track_save_my_signature(text) from public, anon;
revoke all on function public.track_my_signature() from public, anon;
grant execute on function public.track_save_my_signature(text) to authenticated;
grant execute on function public.track_my_signature() to authenticated;
