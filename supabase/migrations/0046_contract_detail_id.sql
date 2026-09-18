-- 0046_contract_detail_id
--
-- The contract page's header is supplier | type | Sequel number | #id, exactly
-- as the old app prints it (Wized `contract_header_contract_no` returns
-- '#' + id; the page suffixes it with -C so it does not read as an invoice
-- number). 0045 left the id out, so the fourth item had nothing to show.
create or replace function public.track_contract_detail(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, xano_mirror
as $$
declare
  v_version text;
  v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select prompt_version into v_version
  from public.track_ai_prompts
  where prompt_key = 'contract_summary';

  select jsonb_build_object(
    'id', c.id,
    'uuid', c.uuid,
    'file_name', c.file_name,
    'contract_type', t.type,
    'supplier', s.title,
    'artist', c.artist,
    'song_name', c.song_name,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'perpetual', coalesce(c.perpetual, false),
    'mcps_yn', coalesce(c.mcps_yn, false),
    'master_pct', c.master_pct,
    'publishing_pct', c.publishing_pct,
    'project_id', c.project_master_list_id,
    'project_uuid', p.uuid,
    'project_title', p.title,
    'project_sequel_no', p.sequel_no,
    'summary', nullif(btrim(coalesce(c.ai_summary, '')), ''),
    'summary_status', nullif(btrim(coalesce(c.ai_summary_status, '')), ''),
    'summary_version', nullif(btrim(coalesce(c.ai_summary_version, '')), ''),
    'prompt_version', v_version,
    'summary_current',
      coalesce(c.ai_summary_status, '') = 'ok'
      and nullif(btrim(coalesce(c.ai_summary, '')), '') is not null
      and nullif(btrim(coalesce(c.ai_summary_version, '')), '') is not distinct from v_version
  )
  into v
  from xano_mirror.contracts c
  left join xano_mirror.contract_types t on t.id = c.contract_type
  left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
  left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
  where c.uuid = p_uuid;

  if v is null then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  return v;
end
$$;

revoke all on function public.track_contract_detail(uuid) from public;
