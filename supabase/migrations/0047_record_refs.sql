-- 0047_record_refs
--
-- One place that decides what a record is called.
--
-- A contract's id and an invoice's number are both four digits and both start
-- with a 1, so "#1013" on the contract page reads as an invoice number at a
-- glance (Andy, 18 Sep). The suffix says which kind of record it is.
--
-- ⚠️ IT IS COMPUTED IN SQL, NOT IN A PAGE, on purpose. The reference belongs to
-- the record, so every reader gets the same string: the page, the list, an
-- email sent from an edge function, an export, Coda. The old app computed the
-- same invoice total four slightly different ways in four places, and this is
-- the same shape of mistake caught early.
--
-- ⚠️ INVOICES ARE NOT IN HERE, deliberately. An invoice already carries a real
-- number from QuickBooks (up to 1170 today); that is what a client pays
-- against and what the accounts are reconciled on. Decorating it would create a
-- second name for a thing that already has one.

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
           else '#' || p_id
         end
$$;

comment on function public.track_ref(text, bigint) is
  'How a record is written on screen and in mail. The one definition - never rebuild it in a page.';

revoke all on function public.track_ref(text, bigint) from public;
grant execute on function public.track_ref(text, bigint) to authenticated, anon;

-- The list the Contracting tab reads. `ref` is appended, so nothing that reads
-- the view by name breaks.
drop view if exists xano_mirror.project_contracts;
create view xano_mirror.project_contracts as
select
  ct.id,
  ct.uuid,
  ct.project_master_list_id,
  ct.file_name,
  ct.file_type,
  ct.file_size,
  ct.description,
  ct.contract_type as contract_type_id,
  t.type as contract_type,
  ct.supplier_list_id,
  s.title as supplier,
  ct.artist,
  ct.song_name,
  ct.notes,
  ct.status,
  ct.confirmed,
  ct.start_date,
  ct.end_date,
  ct.term_value,
  ct.term_unit,
  ct.perpetual,
  ct.renewal_notify_at,
  ct.renewal_notified_at,
  ct.master_pct,
  ct.publishing_pct,
  ct.mcps_yn,
  ct.supplier_address,
  ct.url,
  ct.created_at,
  public.track_ref('contract', ct.id) as ref
from xano_mirror.contracts ct
  left join xano_mirror.contract_types t on t.id = ct.contract_type
  left join xano_mirror.supplier_list s on s.id = ct.supplier_list_id
where coalesce(ct.confirmed, false) and ct.status is distinct from 'Archived';

-- And on the contract page's own payload.
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
    'ref', public.track_ref('contract', c.id),
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
