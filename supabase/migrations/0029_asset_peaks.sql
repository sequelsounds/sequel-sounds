-- 16 Sep 2026. A waveform for shared audio files — Andy, 16 Sep: the /link
-- player should have one running through it, as the playlist player does.
--
-- Same shape as tracks.waveform_peaks: a flat [min, max, min, max, …] array,
-- about 2000 pairs, values between -1 and 1. Tracks get theirs from the Lambda;
-- a project file never goes through it, so the browser works the peaks out:
--   * at upload, from the file on the uploader's machine (staff), and
--   * failing that, the first time the share page plays it (anyone holding a
--     live link) — which is how the files uploaded before this get theirs.
-- The second path is write-once: it cannot replace peaks that already exist.
--
-- Kept outside xano_mirror, keyed by the asset's uuid, because the sync would
-- empty a mirror column.
create table if not exists public.asset_peaks (
  asset_uuid uuid primary key,
  peaks      jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.asset_peaks enable row level security;
revoke all on public.asset_peaks from anon, authenticated;

-- A peaks array is only accepted if it looks like one.
create or replace function public.valid_peaks(p jsonb)
returns boolean
language sql
immutable
as $function$
  -- CASE, not AND: SQL does not promise to stop at the first false.
  select case when jsonb_typeof(p) <> 'array' then false
              when jsonb_array_length(p) not between 2 and 8000 then false
              else not exists (
                select 1 from jsonb_array_elements(p) e
                 where case when jsonb_typeof(e) = 'number'
                            then (e #>> '{}')::numeric not between -1 and 1
                            else true end)
         end
$function$;

create or replace function public.track_set_asset_peaks(p_uuid uuid, p_peaks jsonb)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can do that.' using errcode = '42501';
  end if;
  if not public.valid_peaks(p_peaks) then
    raise exception 'Not a waveform.' using errcode = '22023';
  end if;
  if not exists (select 1 from xano_mirror.project_assets a where a.uuid = p_uuid) then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
  insert into public.asset_peaks (asset_uuid, peaks) values (p_uuid, p_peaks)
  on conflict (asset_uuid) do update set peaks = excluded.peaks, created_at = now();
end
$function$;
revoke all on function public.track_set_asset_peaks(uuid, jsonb) from public, anon;
grant execute on function public.track_set_asset_peaks(uuid, jsonb) to authenticated;

-- The share page's backfill: a live code, and only if there are none yet.
-- Service role only — sign-asset calls it.
create or replace function public.share_set_peaks(p_code text, p_peaks jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_uuid uuid;
begin
  if not public.valid_peaks(p_peaks) then
    return false;
  end if;
  select s.asset_uuid into v_uuid from public.share_links s
   where s.code = btrim(coalesce(p_code, '')) and s.expires_at > now();
  if v_uuid is null then
    return false;
  end if;
  insert into public.asset_peaks (asset_uuid, peaks) values (v_uuid, p_peaks)
  on conflict (asset_uuid) do nothing;
  return true;
end
$function$;
revoke all on function public.share_set_peaks(text, jsonb) from public, anon, authenticated;
grant execute on function public.share_set_peaks(text, jsonb) to service_role;

-- resolve_share_link hands the peaks back with everything else.
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
    'expires_at', v_link.expires_at,
    'peaks', (select p.peaks from public.asset_peaks p where p.asset_uuid = v_asset.uuid)
  );
end
$function$;

-- A deleted file takes its waveform with it.
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
  if exists (select 1 from xano_mirror.briefs b where b.asset_uuid = p_uuid::text) then
    raise exception 'This file is a brief. Remove it from the Briefs tab.' using errcode = '42501';
  end if;
  delete from public.share_links s where s.asset_uuid = p_uuid;
  delete from public.asset_peaks p where p.asset_uuid = p_uuid;
  delete from xano_mirror.project_assets a where a.uuid = p_uuid;
  if not found then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
end
$function$;
