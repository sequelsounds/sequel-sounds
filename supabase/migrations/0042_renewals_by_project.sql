-- Renewals are chased per PROJECT, not per contract — 18 Sep 2026.
--
-- Andy: "we don't want to be getting multiple alerts for every project". He
-- also asked whether a single `licence_date` field on the project would do it.
-- It would not: of 16 live contracts across 13 projects, three projects carry
-- more than one and two of those have DIFFERENT expiries (a master running to
-- one date and the publishing side to another). A single stored field has to
-- pick one, and it also becomes a second copy of a date that lives on the
-- contract — which drifts the moment a date is corrected, and these dates come
-- from an AI reading a PDF, so they do get corrected.
--
-- So: the same one-line-per-project result, worked out from the contracts.
-- The project is chased on the EARLIEST expiry and the rest travel with it.
-- The project page's "Licence expires" is computed in the page from the same
-- contracts, for the same reason.

create or replace function public.track_contract_renewals()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_due jsonb;
  v_unresolved jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can see renewals.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.end_date, g.project_id), '[]'::jsonb) into v_due
  from (
    select p.id as project_id, p.sequel_no, p.title as project_title, p.brand,
           min(c.end_date) as end_date,
           (min(c.end_date) - current_date) as days_left,
           count(*) as contract_count,
           bool_and(c.renewal_notified_at is not null) as all_seen,
           jsonb_agg(jsonb_build_object(
             'id', c.id, 'uuid', c.uuid, 'file_name', c.file_name,
             'supplier', s.title, 'contract_type', t.type,
             'song_name', c.song_name, 'artist', c.artist,
             'end_date', c.end_date, 'start_date', c.start_date,
             'days_left', c.end_date - current_date,
             'seen', c.renewal_notified_at is not null
           ) order by c.end_date, c.id) as contracts
      from xano_mirror.contracts c
      left join xano_mirror.contract_types t on t.id = c.contract_type
      left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
      left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
     where c.confirmed
       and c.status is distinct from 'Archived'
       and not coalesce(c.perpetual, false)
       and c.end_date is not null
       and c.renewal_notify_at is not null
       -- ⚠️ `<= today`, never `= today`: equality silently skips anything
       -- papered after commencement, everything in a backfill, and any day the
       -- page is not opened.
       and c.renewal_notify_at <= current_date
       and c.end_date >= current_date
     group by p.id, p.sequel_no, p.title, p.brand
  ) g;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.latest desc), '[]'::jsonb) into v_unresolved
  from (
    select p.id as project_id, p.sequel_no, p.title as project_title, p.brand,
           max(c.created_at) as latest,
           count(*) as contract_count,
           jsonb_agg(jsonb_build_object(
             'id', c.id, 'uuid', c.uuid, 'file_name', c.file_name,
             'supplier', s.title, 'contract_type', t.type, 'created_at', c.created_at
           ) order by c.created_at desc) as contracts
      from xano_mirror.contracts c
      left join xano_mirror.contract_types t on t.id = c.contract_type
      left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
      left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
     where c.confirmed
       and c.status is distinct from 'Archived'
       and not coalesce(c.perpetual, false)
       and c.end_date is null
     group by p.id, p.sequel_no, p.title, p.brand
  ) g;

  return jsonb_build_object('due', v_due, 'unresolved', v_unresolved,
                            'expired', (select count(*) from xano_mirror.contracts c
                                         where c.confirmed and c.status is distinct from 'Archived'
                                           and not coalesce(c.perpetual, false)
                                           and c.end_date is not null and c.end_date < current_date));
end
$function$;

-- Marking a project dealt with stamps every contract behind that line, so the
-- group cannot come back half-ticked.
create or replace function public.track_mark_renewals_seen(p_uuids uuid[], p_seen boolean)
returns integer
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can do that.' using errcode = '42501';
  end if;
  update xano_mirror.contracts c
     set renewal_notified_at = case when coalesce(p_seen, true) then now() else null end
   where c.uuid = any(p_uuids);
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.track_mark_renewals_seen(uuid[], boolean) from public, anon;
grant execute on function public.track_mark_renewals_seen(uuid[], boolean) to authenticated;
