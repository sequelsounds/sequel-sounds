-- 0051_release_form_actions
--
-- Share, archive, edit and send for release forms — the same four things every
-- other row in this app has. The first cut gave the row a bare OPEN button and
-- nothing else, which was wrong: a row here shares and archives, and clicking
-- it opens what it is (Andy, 19 Sep).
--
-- ⚠️ EDITING REDRAWS THE PDF OVER THE SAME KEY. There is one file per form and
-- its key never changes, so a link already shared keeps working and shows the
-- corrected letter. The alternative — a new key each save — leaves the old file
-- behind S3 with a live signed url pointing at superseded terms.
--
-- ⚠️ `issued_on` does NOT move on an edit. It is the date printed on the letter
-- and the date the broadcaster was told; correcting a typo does not re-date it.

alter table public.track_release_forms
  add column if not exists recipient_email text,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text,
  add column if not exists send_error text;

comment on column public.track_release_forms.sent_to is
  'Who the last send went to. The cc to the person who issued it is implied and not stored.';

-- ------------------------------------------------------------------ sharing
alter table public.share_links
  add column if not exists release_form_uuid uuid;
create index if not exists share_links_release_form_uuid_idx
  on public.share_links (release_form_uuid);
alter table public.share_links drop constraint if exists share_links_one_target;
alter table public.share_links add constraint share_links_one_target
  check (num_nonnulls(asset_uuid, contract_uuid, release_form_uuid) = 1);

create or replace function public.track_share_release_form(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text := public.share_code();
  v_expires timestamptz := now() + interval '7 days';
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can share release forms.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.track_release_forms r
                  where r.uuid = p_uuid and r.status is distinct from 'Archived') then
    raise exception 'Release form not found.' using errcode = 'P0002';
  end if;
  insert into public.share_links (code, release_form_uuid, created_by, expires_at)
  values (v_code, p_uuid, public.track_user_id(), v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$function$;

-- ---------------------------------------------------------------- archiving
-- Archive, never delete — the house rule for anything that was sent. The link
-- goes with it, so a shared url stops resolving the moment it is withdrawn.
create or replace function public.track_archive_release_form(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.share_links s where s.release_form_uuid = p_uuid;
  update public.track_release_forms set status = 'Archived' where uuid = p_uuid;
  if not found then
    raise exception 'Release form not found.' using errcode = 'P0002';
  end if;
end
$function$;

-- ------------------------------------------------------------------ reading
-- Everything the modal needs to open again on a row that already exists.
create or replace function public.track_release_form_detail(p_uuid uuid)
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
  return jsonb_build_object(
    'uuid', r.uuid,
    'ref', public.track_ref('release', r.id),
    'recipient_name', r.recipient_name,
    'recipient_address', coalesce(r.recipient_address, ''),
    'recipient_email', coalesce(r.recipient_email, ''),
    'brand', r.brand,
    'campaign', r.campaign,
    'track_name', r.track_name,
    'term', r.term,
    'territory', r.territory,
    'media', r.media,
    'scripts', r.scripts,
    'signer_name', r.signer_name,
    'issued_on', r.issued_on,
    'sent_at', r.sent_at,
    'sent_to', r.sent_to,
    'send_error', r.send_error);
end
$function$;

-- ------------------------------------------------------------------ editing
-- ⚠️ Returns the SAME key the form already has. The caller redraws onto it.
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
    'issued_on', r.issued_on);
end
$function$;

-- -------------------------------------------------------------------- send
create or replace function public.track_mark_release_form_sent(
  p_uuid uuid, p_to text, p_error text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.track_release_forms
     set sent_at    = case when p_error is null then now() else sent_at end,
         sent_to    = case when p_error is null then p_to else sent_to end,
         send_error = p_error
   where uuid = p_uuid;
end
$function$;

-- Who the copy goes to. The person who issued the form, from their own row —
-- never an address the browser supplies.
create or replace function public.track_my_email()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select u.email from public.track_users u where u.auth_user_id = auth.uid();
$$;

-- ----------------------------------------------------------------- creating
-- ⚠️ THE OLD TEN-ARGUMENT VERSION IS DROPPED FIRST. Adding an eleventh with a
-- default would leave two functions of the same name, and PostgREST then has to
-- guess which one a call meant — it picks by the keys sent, so a form saved
-- without an email would silently land on the old one and the email would go
-- nowhere with nothing to show for it.
drop function if exists public.track_create_release_form(
  bigint, text, text, text, text, text, text, text, text, text);

-- Recreated to take the email. Everything else is as 0049 left it.
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
     brand, campaign, track_name, term, territory, media, scripts, signer_name, issued_on,
     aws_path, file_name, created_by)
  values
    (v_uuid, p_project_id, btrim(p_recipient_name), nullif(btrim(coalesce(p_recipient_address, '')), ''),
     nullif(btrim(coalesce(p_recipient_email, '')), ''),
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

-- The list gains what the row now shows.
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
             'recipient_email', coalesce(r.recipient_email, ''),
             'track_name', r.track_name,
             'brand', r.brand,
             'campaign', r.campaign,
             'signer_name', r.signer_name,
             'issued_on', r.issued_on,
             'sent_at', r.sent_at,
             'created_at', r.created_at) as x
    from public.track_release_forms r
    where r.project_master_list_id = p_project_id
      and r.status <> 'Archived'
  ) s;
  return v;
end
$function$;

-- ------------------------------------------------------- the public link
-- resolve_share_link answered for assets and contracts; a release form link
-- would have read as an invalid code.
create or replace function public.resolve_share_link(p_code text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_link public.share_links;
  v_asset xano_mirror.project_assets;
  v_contract xano_mirror.contracts;
  v_release public.track_release_forms;
  v_key text := 'share_read_' || coalesce(nullif(p_ip, ''), 'unknown');
  v_row public.rate_limits;
begin
  insert into public.rate_limits (limit_key, hits, window_start) values (v_key, 0, now())
  on conflict (limit_key) do nothing;
  select * into v_row from public.rate_limits where limit_key = v_key for update;
  if v_row.window_start + interval '5 minutes' < now() then
    update public.rate_limits set hits = 1, window_start = now() where limit_key = v_key;
  elsif v_row.hits >= 30 then
    return jsonb_build_object('error', 'busy');
  else
    update public.rate_limits set hits = hits + 1 where limit_key = v_key;
  end if;

  select * into v_link from public.share_links s where s.code = btrim(coalesce(p_code, ''));
  if not found then
    return jsonb_build_object('error', 'invalid');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('error', 'expired');
  end if;

  if v_link.release_form_uuid is not null then
    select * into v_release from public.track_release_forms r where r.uuid = v_link.release_form_uuid;
    if not found or coalesce(v_release.aws_path, '') = ''
       or v_release.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'release_form',
      'key', v_release.aws_path,
      'file_name', v_release.file_name,
      'file_type', 'application/pdf',
      'file_size', null,
      'expires_at', v_link.expires_at
    );
  end if;

  if v_link.contract_uuid is not null then
    select * into v_contract from xano_mirror.contracts c where c.uuid = v_link.contract_uuid;
    if not found or coalesce(v_contract.aws_path, '') = ''
       or v_contract.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'contract',
      'key', v_contract.aws_path,
      'file_name', v_contract.file_name,
      'file_type', coalesce(nullif(v_contract.file_type, ''), 'application/pdf'),
      'file_size', v_contract.file_size,
      'expires_at', v_link.expires_at
    );
  end if;

  select * into v_asset from xano_mirror.project_assets a where a.uuid = v_link.asset_uuid;
  if not found or coalesce(v_asset.aws_path, '') = '' then
    return jsonb_build_object('error', 'invalid');
  end if;
  return jsonb_build_object(
    'kind', 'asset',
    'key', v_asset.aws_path,
    'file_name', v_asset.file_name,
    'file_type', v_asset.file_type,
    'file_size', v_asset.file_size,
    'expires_at', v_link.expires_at
  );
end
$function$;

revoke all on function public.resolve_share_link(text, text) from public, anon, authenticated;
grant execute on function public.resolve_share_link(text, text) to service_role;

revoke all on function public.track_share_release_form(uuid) from public, anon;
revoke all on function public.track_archive_release_form(uuid) from public, anon;
revoke all on function public.track_release_form_detail(uuid) from public, anon;
revoke all on function public.track_update_release_form(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.track_mark_release_form_sent(uuid, text, text) from public, anon;
revoke all on function public.track_my_email() from public, anon;
revoke all on function public.track_create_release_form(bigint, text, text, text, text, text, text, text, text, text, text) from public, anon;

grant execute on function public.track_share_release_form(uuid) to authenticated;
grant execute on function public.track_archive_release_form(uuid) to authenticated;
grant execute on function public.track_release_form_detail(uuid) to authenticated;
grant execute on function public.track_update_release_form(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.track_mark_release_form_sent(uuid, text, text) to authenticated;
grant execute on function public.track_my_email() to authenticated;
grant execute on function public.track_create_release_form(bigint, text, text, text, text, text, text, text, text, text, text) to authenticated;
