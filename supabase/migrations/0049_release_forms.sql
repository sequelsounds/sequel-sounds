-- 0049_release_forms
--
-- The + RELEASE FORM button on a project's Contracting tab.
--
-- A release form is NOT a contract and does not live with them. It grants
-- nothing: it tells a broadcaster that a track has been cleared and on what
-- terms, deliberately without the money. It also commonly goes out BEFORE any
-- contract exists, which is why it cannot hang off a contract row.
--   — Andy, 18-19 Sep 2026.
--
-- So it gets its own table, in `public`, OUTSIDE the Xano mirror. Nothing
-- downstream reads it, there is no Xano counterpart, and therefore none of the
-- four mirror insert traps apply: the sequence, the uuid default and the
-- integer-FK-to-zero problem are all mirror problems, and this table has none
-- of them.
--
-- ⚠️ ONE TRACK PER FORM. Two tracks is two forms — Andy, 19 Sep. There is
-- deliberately no track list here, and the document says "The below track has
-- been cleared", singular, with no pluralisation to get wrong. The sample that
-- prompted all this read "The below two track has been cleared".
--
-- ⚠️ THE FILE GOES UNDER `contracts/release-forms/`. Not because a release form
-- is a contract, but because `sequel-sounds-signer` already holds
-- Put/Get/Delete on `contracts/*` (the inline policy
-- `sequel-sounds-media-contracts-rw`, added 17 Sep). A new top-level prefix
-- would need a new IAM policy before a single form could be saved. The path
-- still says what these are.

create table if not exists public.track_release_forms (
  id                     bigserial primary key,
  uuid                   uuid not null unique default gen_random_uuid(),
  project_master_list_id bigint not null,
  -- Who it is addressed to. The address is free text, one line per line, and
  -- is printed right-aligned exactly as typed.
  recipient_name         text not null,
  recipient_address      text,
  -- The document reads "<brand> – <campaign> as per the below terms". Two
  -- fields, not one production name — Andy's own amendment to the template.
  brand                  text not null,
  campaign               text not null,
  track_name             text not null,
  term                   text not null,
  territory              text not null,
  media                  text not null,
  scripts                text not null,
  -- Stamped here, not sent by the browser: the signer is whoever was logged in.
  signer_name            text not null,
  issued_on              date not null,
  aws_path               text not null,
  file_name              text not null,
  status                 text not null default 'Active',
  created_by             bigint,
  created_at             timestamptz not null default now()
);

comment on table public.track_release_forms is
  'Clearance letters issued to broadcasters. One track each. Not contracts, and deliberately outside the Xano mirror.';

create index if not exists track_release_forms_project_idx
  on public.track_release_forms (project_master_list_id, created_at desc);

alter table public.track_release_forms enable row level security;

-- Staff only, and only through the functions below — no direct writes, so the
-- signer and the file key can never be supplied by a browser.
drop policy if exists track_release_forms_read on public.track_release_forms;
create policy track_release_forms_read on public.track_release_forms
  for select to authenticated using (public.track_is_staff());

grant select on public.track_release_forms to authenticated;
grant usage, select on sequence public.track_release_forms_id_seq to authenticated;

-- ---------------------------------------------------------------- the ref
-- '#1000-R', alongside contracts, quotes and songs. One definition of what a
-- record is called, in SQL, never rebuilt in a page.
create or replace function public.track_ref(p_kind text, p_id bigint)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
           when p_id is null then null
           when p_kind = 'contract' then '#' || p_id || '-C'
           when p_kind = 'quote'    then '#' || p_id || '-Q'
           when p_kind = 'song'     then '#' || p_id || '-S'
           when p_kind = 'release'  then '#' || p_id || '-R'
           else '#' || p_id
         end
$$;

revoke all on function public.track_ref(text, bigint) from public;
grant execute on function public.track_ref(text, bigint) to authenticated, anon;

-- --------------------------------------------------------------- creating
-- The row is written first and hands back the only key the signer will sign,
-- exactly as contracts and assets do. The caller never names a key.
--
-- ⚠️ THE SIGNER NAME COMES FROM THE DATABASE, not the request. It is printed on
-- a letter that tells a broadcaster music is cleared; letting the browser
-- choose whose name goes on it would be a gift to nobody.
--
-- ⚠️ The job title is NOT stored or chosen. Every supervisor signs as "Music
-- Supervisor – Sequel" and that line is fixed in the document itself — Andy,
-- 19 Sep. `track_users.job_title` is empty for all three Sequel users, which is
-- why. Do not "improve" this into a lookup without asking him.
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
  p_scripts text)
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

  -- Every printed field is required. A release form with a blank Territory is
  -- worse than no release form: it reads as cleared everywhere.
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
    (uuid, project_master_list_id, recipient_name, recipient_address, brand, campaign,
     track_name, term, territory, media, scripts, signer_name, issued_on,
     aws_path, file_name, created_by)
  values
    (v_uuid, p_project_id, btrim(p_recipient_name), nullif(btrim(coalesce(p_recipient_address, '')), ''),
     btrim(p_brand), btrim(p_campaign), btrim(p_track_name), btrim(p_term), btrim(p_territory),
     btrim(p_media), btrim(p_scripts), btrim(v_me.full_name), (now() at time zone 'Europe/London')::date,
     v_key, 'Release Form ' || btrim(p_track_name) || '.pdf', v_me.id)
  returning id into v_id;

  return jsonb_build_object(
    'uuid', v_uuid,
    'key', v_key,
    'ref', public.track_ref('release', v_id),
    'signer_name', btrim(v_me.full_name),
    'issued_on', (now() at time zone 'Europe/London')::date);
end
$function$;

-- ------------------------------------------------------------------ reading
create or replace function public.track_release_form_key(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare r public.track_release_forms%rowtype;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.track_release_forms where uuid = p_uuid;
  if not found then
    raise exception 'Release form not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('key', r.aws_path, 'file_name', r.file_name);
end
$function$;

-- The Contracting tab's second list. Its own list, not mixed in with contracts:
-- those point IN, at what Sequel licensed from someone, and these point OUT.
create or replace function public.track_project_release_forms(p_project_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', r.id,
             'uuid', r.uuid,
             'ref', public.track_ref('release', r.id),
             'recipient_name', r.recipient_name,
             'track_name', r.track_name,
             'brand', r.brand,
             'campaign', r.campaign,
             'signer_name', r.signer_name,
             'issued_on', r.issued_on,
             'created_at', r.created_at) as x
    from public.track_release_forms r
    where r.project_master_list_id = p_project_id
      and r.status <> 'Archived'
  ) s;
  return v;
end
$function$;

-- An abandoned create: the row goes. The object, if one was ever written, is
-- swept at cutover the same way a discarded contract's is.
create or replace function public.track_discard_release_form(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.track_release_forms where uuid = p_uuid;
end
$function$;

revoke all on function public.track_create_release_form(bigint, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.track_release_form_key(uuid) from public, anon;
revoke all on function public.track_project_release_forms(bigint) from public, anon;
revoke all on function public.track_discard_release_form(uuid) from public, anon;

grant execute on function public.track_create_release_form(bigint, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.track_release_form_key(uuid) to authenticated;
grant execute on function public.track_project_release_forms(bigint) to authenticated;
grant execute on function public.track_discard_release_form(uuid) to authenticated;
