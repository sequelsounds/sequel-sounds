-- The share page's waveform never survived a reload.
--
-- `share_set_peaks` has been writing rows into public.asset_peaks since
-- 15 Sep, but `resolve_share_link` never read them back, so sign-asset's
-- share response always carried `peaks: null`. Every visitor therefore
-- downloaded the whole file and decoded it again from scratch — 103 MB for
-- a 47-second video — and the bar sat flat until that finished, on every
-- single visit.
--
-- Only the asset branch gains the lookup: contracts and release forms are
-- PDFs and have no waveform.
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
    'expires_at', v_link.expires_at,
    -- The one new line. Null until someone's browser has worked it out.
    'peaks', (select p.peaks from public.asset_peaks p where p.asset_uuid = v_asset.uuid)
  );
end
$function$;
