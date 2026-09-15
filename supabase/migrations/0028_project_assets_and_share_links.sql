-- 16 Sep 2026. Project assets written by the new app, and the share links
-- behind /link. Copies Xano's Project Assets API group (create_asset_row,
-- upload, Update_Asset_Description, delete_asset, project_assets) and the
-- short_link table, rule for rule, with three changes:
--
--  * Files go to the new app's bucket, sequel-sounds-media, under the same
--    key shape Xano uses (project-assets/{uuid}_{filename}) — Andy, 16 Sep.
--    The 17 existing files are copied across with that shape kept, so every
--    row's aws_path stays true.
--  * The uuid is minted here, not in the browser (the old app's open item).
--  * A share link is minted when SHARE is clicked, not on every list load
--    (the old app's known issue: a new short_link row per asset per view).
--
-- The S3 side lives in the `sign-asset` Edge Function. The database decides
-- who may do what; the function only signs keys these functions hand it.
--
-- ⚠️ project_assets is still in the hourly sync. New-app rows are deleted on
-- the next full push, and THEIR FILES ARE NOT — clean up test objects by hand.

-- ------------------------------------------------------------ mirror traps 1+2
create sequence if not exists xano_mirror.project_assets_id_seq as bigint start with 1000
  owned by xano_mirror.project_assets.id;
select setval('xano_mirror.project_assets_id_seq',
              greatest(1000, coalesce((select max(id) from xano_mirror.project_assets), 0) + 1), false);
alter table xano_mirror.project_assets
  alter column id set default nextval('xano_mirror.project_assets_id_seq'),
  alter column uuid set default gen_random_uuid();

-- ------------------------------------------------------------------- assets
-- create_asset_row: the row BEFORE the file. If the upload never lands, an
-- unconfirmed row is left (and hidden); an object with no row would be
-- invisible for ever, because nothing scans the bucket.
create or replace function public.track_create_asset(
  p_project_id bigint, p_file_name text, p_file_size text, p_file_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_uuid uuid := gen_random_uuid();
  -- Path separators out, so a crafted name cannot leave the prefix.
  v_name text := nullif(btrim(replace(replace(coalesce(p_file_name, ''), '/', '_'), '\', '_')), '');
  v_key text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can upload files.' using errcode = '42501';
  end if;
  if not exists (select 1 from xano_mirror.project_master_list p where p.id = p_project_id) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  v_key := 'project-assets/' || v_uuid || '_' || coalesce(v_name, v_uuid::text);

  insert into xano_mirror.project_assets
    (uuid, project_master_list_id, uploaded_by, file_name, file_size, file_type,
     aws_path, url, confirmed, created_at)
  values
    (v_uuid, p_project_id::integer, public.track_user_id()::integer, coalesce(v_name, v_uuid::text),
     coalesce(nullif(btrim(p_file_size), ''), ''), coalesce(nullif(btrim(p_file_type), ''), ''),
     v_key, v_key, false, now());

  return jsonb_build_object('uuid', v_uuid, 'key', v_key);
end
$function$;

-- Update_Asset_Description: confirms an upload, and is also the edit save.
-- A tag outside the five is refused; an empty one keeps what the row has.
create or replace function public.track_save_asset(p_uuid uuid, p_description text, p_tag text)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_tag text := nullif(btrim(p_tag), '');
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can edit files.' using errcode = '42501';
  end if;
  if v_tag is not null and v_tag not in ('Final edit', 'WIP', 'Deck', 'Reference', 'Other') then
    raise exception 'Pick one of Final edit, WIP, Deck, Reference or Other.' using errcode = '22023';
  end if;
  update xano_mirror.project_assets a
     set description = nullif(btrim(p_description), ''),
         asset_tag = coalesce(v_tag, a.asset_tag),
         confirmed = true
   where a.uuid = p_uuid;
  if not found then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
end
$function$;

-- The S3 key for a staff read or delete. Only a key the database holds is
-- ever signed.
create or replace function public.track_asset_key(p_uuid uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_key text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can open this file.' using errcode = '42501';
  end if;
  select a.aws_path into v_key from xano_mirror.project_assets a where a.uuid = p_uuid;
  if coalesce(v_key, '') = '' then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
  return v_key;
end
$function$;

-- The row half of a delete. The function deletes the object first, as Xano
-- does: if S3 refuses, the row survives to be tried again.
create or replace function public.track_delete_asset(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can delete files.' using errcode = '42501';
  end if;
  -- A brief's file goes with the brief, not from here.
  if exists (select 1 from xano_mirror.briefs b where b.asset_uuid = p_uuid::text) then
    raise exception 'This file is a brief. Remove it from the Briefs tab.' using errcode = '42501';
  end if;
  delete from public.share_links s where s.asset_uuid = p_uuid;
  delete from xano_mirror.project_assets a where a.uuid = p_uuid;
  if not found then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
end
$function$;

-- ------------------------------------------------------------- share links
-- short_link, rebuilt. Not in xano_mirror, because the sync would empty it.
create table if not exists public.share_links (
  code        text primary key,
  asset_uuid  uuid not null,
  created_by  bigint,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists share_links_asset_uuid_idx on public.share_links (asset_uuid);
alter table public.share_links enable row level security;
revoke all on public.share_links from anon, authenticated;

-- 10 characters rather than Xano's 6: the link opens a file to anyone who
-- holds it, and the page is public.
create or replace function public.share_code()
returns text
language plpgsql
volatile
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
declare
  v_alpha constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_out text := '';
begin
  for i in 0..9 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % 62) + 1, 1);
  end loop;
  return v_out;
end
$function$;
revoke all on function public.share_code() from public, anon, authenticated;

-- SHARE on an asset row. A fresh link each time, live for 7 days — what the
-- share modal says.
create or replace function public.track_share_asset(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_code text := public.share_code();
  v_expires timestamptz := now() + interval '7 days';
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can share files.' using errcode = '42501';
  end if;
  if not exists (select 1 from xano_mirror.project_assets a where a.uuid = p_uuid and a.confirmed) then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
  insert into public.share_links (code, asset_uuid, created_by, expires_at)
  values (v_code, p_uuid, public.track_user_id(), v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$function$;

-- Every asset on a project at once, for EMAIL BRIEF's PROJECT ASSETS section.
-- Brief files are left out, as they are from the list.
create or replace function public.track_share_project_assets(p_project_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
  v_code text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can share files.' using errcode = '42501';
  end if;
  for r in
    select a.uuid, coalesce(nullif(a.description, ''), a.file_name) as label
      from xano_mirror.project_assets a
     where a.project_master_list_id = p_project_id
       and a.confirmed
       and not exists (select 1 from xano_mirror.briefs b where b.asset_uuid = a.uuid::text)
     order by a.created_at
  loop
    v_code := public.share_code();
    insert into public.share_links (code, asset_uuid, created_by, expires_at)
    values (v_code, r.uuid, public.track_user_id(), now() + interval '7 days');
    v_out := v_out || jsonb_build_object('label', r.label, 'code', v_code);
  end loop;
  return v_out;
end
$function$;

-- What /link needs, for the sign-asset function only (service role). The
-- function passes the caller's IP, because a call from the function carries
-- the function's own address. 30 per IP per 5 minutes.
create or replace function public.resolve_share_link(p_code text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_link public.share_links;
  v_asset xano_mirror.project_assets;
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
  select * into v_asset from xano_mirror.project_assets a where a.uuid = v_link.asset_uuid;
  if not found or coalesce(v_asset.aws_path, '') = '' then
    return jsonb_build_object('error', 'invalid');
  end if;
  return jsonb_build_object(
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

-- ------------------------------------------------------------ upload brief
-- attach_brief_upload: the uploaded file becomes a brief. Confirms the asset
-- (named after the brief) and creates the Briefs row, Submitted, with a token
-- that is dead on arrival — an uploaded brief has no form to fill in.
create or replace function public.track_attach_brief_upload(p_asset_uuid uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_asset xano_mirror.project_assets;
  v_name text;
  v_id bigint;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can upload a brief.' using errcode = '42501';
  end if;
  select * into v_asset from xano_mirror.project_assets a where a.uuid = p_asset_uuid for update;
  if not found then
    raise exception 'The uploaded file wasn''t found. Please upload it again.' using errcode = 'P0002';
  end if;
  v_name := coalesce(nullif(btrim(p_name), ''), v_asset.file_name);

  update xano_mirror.project_assets a set description = v_name, confirmed = true where a.uuid = p_asset_uuid;

  insert into xano_mirror.briefs
    (project_master_list_id, name, status, source, asset_uuid, requested_by,
     submitted_at, share_token, share_expires_at, created_at)
  values
    (v_asset.project_master_list_id, v_name, 'Submitted', 'upload', p_asset_uuid::text,
     public.track_user_id()::integer, now(), public.brief_token(), now(), now())
  returning id into v_id;

  return jsonb_build_object('brief_id', v_id);
end
$function$;

-- ------------------------------------------------------------------ grants
revoke all on function public.track_create_asset(bigint, text, text, text) from public, anon;
revoke all on function public.track_save_asset(uuid, text, text) from public, anon;
revoke all on function public.track_asset_key(uuid) from public, anon;
revoke all on function public.track_delete_asset(uuid) from public, anon;
revoke all on function public.track_share_asset(uuid) from public, anon;
revoke all on function public.track_share_project_assets(bigint) from public, anon;
revoke all on function public.track_attach_brief_upload(uuid, text) from public, anon;
grant execute on function public.track_create_asset(bigint, text, text, text) to authenticated;
grant execute on function public.track_save_asset(uuid, text, text) to authenticated;
grant execute on function public.track_asset_key(uuid) to authenticated;
grant execute on function public.track_delete_asset(uuid) to authenticated;
grant execute on function public.track_share_asset(uuid) to authenticated;
grant execute on function public.track_share_project_assets(bigint) to authenticated;
grant execute on function public.track_attach_brief_upload(uuid, text) to authenticated;

-- -------------------------------------------------------------------- views
-- The Assets list: confirmed files only (Xano's list has always filtered
-- them), and never a brief's file — that lives on the Briefs tab.
-- ⚠️ Columns appended, never reordered.
create or replace view xano_mirror.project_files
with (security_invoker = true) as
select a.id,
    a.project_master_list_id,
    a.file_name,
    a.description,
    a.asset_tag,
    case when btrim(a.file_size) ~ '^[0-9]+$' then btrim(a.file_size)::bigint else null::bigint end as file_size,
    a.file_type,
    a.url,
    a.final_edit,
    u.name as uploaded_by,
    a.created_at,
    a.uuid
   from xano_mirror.project_assets a
     left join xano_mirror."user" u on u.id = a.uploaded_by
  where a.confirmed is true
    and not exists (select 1 from xano_mirror.briefs b where b.asset_uuid = a.uuid::text);

-- The Briefs tab says what kind of file an uploaded brief is.
create or replace view xano_mirror.project_briefs
with (security_invoker = true) as
select b.id,
    b.project_master_list_id,
    b.name,
    b.brief_type,
    b.status,
    b.source,
    b.one_sentence_brief,
    b.vocal_or_instrumental,
    b.client_deadline,
    b.sequel_deadline,
    b.submitted_at,
    u.name as requested_by,
    ((nullif(btrim(b.share_token), '') is not null) and ((b.share_expires_at is null) or (b.share_expires_at > now()))) as share_link_live,
    b.created_at,
    case
      when nullif(btrim(b.share_token), '') is not null
       and b.submitted_at is null
       and (b.share_expires_at is null or b.share_expires_at > now())
      then b.share_token
    end as share_token,
    b.share_expires_at,
    f.file_name,
    f.file_type,
    b.asset_uuid
   from xano_mirror.briefs b
     left join xano_mirror."user" u on u.id = b.requested_by
     left join xano_mirror.project_assets f on nullif(b.asset_uuid, '') is not null and f.uuid::text = b.asset_uuid;
