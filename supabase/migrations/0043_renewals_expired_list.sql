-- Renewals: Expiring, Expired, Missing dates — 18 Sep 2026.
--
-- Andy: "should this just be Expiring and expired tabs? Contracts that are
-- perpetual don't need to be in the renewals tabs." Perpetual never was in any
-- of these lists; what changes here is that ALREADY LAPSED becomes a list
-- rather than a count — a licence that ran out is the one someone may still be
-- using — and the third list is named for what it is (no dates at all), so it
-- cannot be read as "perpetual".
--
-- The perpetual count is returned only so the page can say out loud that they
-- are not chased, rather than leaving their absence looking like a gap.

create or replace function public.track_contract_renewals()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_due jsonb;
  v_expired jsonb;
  v_unresolved jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can see renewals.' using errcode = '42501';
  end if;

  -- Expiring: one line per project, chased on its EARLIEST expiry.
  -- ⚠️ `renewal_notify_at <= today`, never `= today`: equality silently skips
  -- anything papered after commencement, everything in a backfill, and any day
  -- the page is not opened.
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
       and c.renewal_notify_at <= current_date
       and c.end_date >= current_date
     group by p.id, p.sequel_no, p.title, p.brand
  ) g;

  -- Expired: read from the other end of today, on the LATEST expiry, because
  -- that is when cover actually stopped.
  select coalesce(jsonb_agg(to_jsonb(g) order by g.end_date desc), '[]'::jsonb) into v_expired
  from (
    select p.id as project_id, p.sequel_no, p.title as project_title, p.brand,
           max(c.end_date) as end_date,
           (current_date - max(c.end_date)) as days_since,
           count(*) as contract_count,
           bool_and(c.renewal_notified_at is not null) as all_seen,
           jsonb_agg(jsonb_build_object(
             'id', c.id, 'uuid', c.uuid, 'file_name', c.file_name,
             'supplier', s.title, 'contract_type', t.type,
             'song_name', c.song_name, 'artist', c.artist,
             'end_date', c.end_date, 'start_date', c.start_date,
             'days_left', c.end_date - current_date,
             'seen', c.renewal_notified_at is not null
           ) order by c.end_date desc, c.id) as contracts
      from xano_mirror.contracts c
      left join xano_mirror.contract_types t on t.id = c.contract_type
      left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
      left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
     where c.confirmed
       and c.status is distinct from 'Archived'
       and not coalesce(c.perpetual, false)
       and c.end_date is not null
       and c.end_date < current_date
     group by p.id, p.sequel_no, p.title, p.brand
  ) g;

  -- Missing dates: confirmed, NOT perpetual, no expiry at all. Usually the
  -- reader found no dates and nobody filled them in. Nothing chases these, so
  -- without the list they are invisible until a client asks.
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

  return jsonb_build_object('due', v_due, 'expired', v_expired, 'unresolved', v_unresolved,
                            'perpetual', (select count(*) from xano_mirror.contracts c
                                           where c.confirmed and c.status is distinct from 'Archived'
                                             and coalesce(c.perpetual, false)));
end
$function$;
