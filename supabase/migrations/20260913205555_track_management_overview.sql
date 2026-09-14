-- /management, rebuilt from Xano's management_overview (api 591) and the
-- fee splitter it leans on, invoice_fee_breakdown (fn 76).
--
-- ⚠️ MANAGEMENT ONLY, NOT STAFF. Track guards this endpoint with
-- assert_management, never assert_sequel_staff: it shows every supervisor's
-- billing, profit and margin. Camila is staff and must not see it. The mirror
-- tables' own RLS grants staff everything, so the gate has to live here, in
-- the view, or the rebuild would leak what Track does not.
create or replace function public.track_is_management()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from public.track_users
     where auth_user_id = auth.uid()
       and user_type in ('Admin','Sequel')
       and coalesce(is_management, false)
       and status not in ('Blocked','Archived')
  );
$$;

comment on function public.track_is_management() is
  'True for a signed-in Sequel user carrying the management flag (Andy, Phil). The gate on /management, mirroring Xano fn 77 assert_management.';

-- One row per live invoice, every figure already in GBP.
--
-- ⚠️ GBP VIA exchange_rate_lock (local * rate = GBP). NOT gbp_total_amount,
-- which is zero on 148 of 150 rows and wrong on the two that are set, and NOT
-- eur_rate, which is Unilever's fixed rate. A missing rate is treated as 1
-- rather than zeroing the invoice.
--
-- ⚠️ THE FEE BUCKETS ARE fn 76's, NOT A READ OF THE COLUMNS. A Sequel fee
-- lives in BOTH the flat header columns AND Invoice_Line_Items rows carrying
-- line_type = 'sequel_fee', and both are summed. Contingency is not its own
-- bucket: each contingency column joins the category it was quoted against,
-- and contingency LINE rows route on their category, which is why category is
-- read for fee rows and not only for third-party ones.
--
-- ⚠️ cost_avoidance is in no total. It records money that did not move.
create or replace view xano_mirror.management_invoices
with (security_invoker = true) as
select
  i.id,
  i.uuid,
  i.invoice_number,
  coalesce(p.title, '')                                   as project_title,
  coalesce(p.brand, '')                                   as brand,
  coalesce(p.brand_category, 0)                           as category_id,
  -- "Unclassified" and "Unassigned" are real reported values, not blanks.
  coalesce(bc.category, 'Unclassified')                   as category,
  coalesce(ag.company, '')                                as agency,
  coalesce(rg.region, 'Unassigned')                       as region,
  coalesce(p.client, 0) = 1                               as is_unilever,
  i.invoice_date,
  i.status,
  i.music_supervisor_id                                   as supervisor_id,
  i.client_id,
  coalesce(cl.company, '')                                as client_name,
  round(coalesce(i.total_to_invoice, 0) * r.rate, 2)      as invoiced,
  round(f.sequel_total * r.rate, 2)                       as profit,
  round(coalesce(i.gross_spend, 0) * r.rate, 2)           as spend,
  round(f.third_party * r.rate, 2)                        as third_party,
  round(f.studios * r.rate, 2)                            as studios,
  round(f.demo * r.rate, 2)                               as demo,
  round(f.search * r.rate, 2)                             as search,
  round(f.licence * r.rate, 2)                            as licence,
  round(f.other * r.rate, 2)                              as other,
  round(
    ( coalesce(i.demo_cost_avoidance, 0)
    + coalesce(i.search_cost_avoidance, 0)
    + coalesce(i.master_cost_avoidance, 0)
    + coalesce(i.publishing_cost_avoidance, 0)
    + coalesce(i.other_cost_avoidance, 0) ) * r.rate, 2)  as cost_avoidance
from xano_mirror.invoices i
cross join lateral (
  select case when coalesce(i.exchange_rate_lock, 0) = 0
              then 1::numeric else i.exchange_rate_lock end as rate
) r
left join xano_mirror.project_master_list p on p.id = i.project_master_list_id
left join xano_mirror.clients            cl on cl.id = i.client_id
left join xano_mirror.regions            rg on rg.id = cl.region
left join xano_mirror.clients            ag on ag.id = p.client_agency and p.client_agency > 0
left join xano_mirror.brand_category     bc on bc.id = p.brand_category
cross join lateral (
  -- The header columns, then the line rows, exactly as fn 76 folds them.
  select
    h.demo + l.demo            as demo,
    h.search + l.search        as search,
    h.licence + l.licence      as licence,
    h.studios + l.studios      as studios,
    h.other + l.other          as other,
    l.in_house                 as in_house,
    l.third_party              as third_party,
    h.demo + l.demo + h.search + l.search + h.licence + l.licence
      + h.studios + l.studios + h.other + l.other + l.in_house as sequel_total
  from (
    select
      coalesce(i.sequel_demo_fee, 0)   + coalesce(i.demo_contingency_fee, 0)   as demo,
      coalesce(i.sequel_search_fee, 0) + coalesce(i.search_contingency_fee, 0) as search,
      coalesce(i.master_sequel_licence_fee, 0)
        + coalesce(i.publishing_sequel_licence_fee, 0)
        + coalesce(i.license_contingency_fee, 0)                               as licence,
      coalesce(i.master_sequel_studios_fee, 0)
        + coalesce(i.publishing_sequel_studios_fee, 0)                         as studios,
      coalesce(i.sequel_consultancy_fee, 0) + coalesce(i.other_contingency_fee, 0) as other
  ) h
  cross join lateral (
    select
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and (
          li.fee_type = 'demo'
          or (li.fee_type = 'contingency' and li.category = 'Demos'))), 0)       as demo,
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and (
          li.fee_type = 'search'
          or (li.fee_type = 'contingency' and li.category = 'Searches'))), 0)    as search,
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and (
          li.fee_type = 'licence'
          or (li.fee_type = 'contingency'
              and li.category in ('Licence','Library Master','Publishing')))), 0) as licence,
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and li.fee_type = 'studios'), 0)       as studios,
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and (
          li.fee_type = 'consultancy'
          or (li.fee_type = 'contingency' and li.category = 'Other Fees'))), 0)  as other,
      coalesce(sum(li.fee_amount) filter (
        where li.line_type = 'sequel_fee' and li.fee_type = 'in_house'), 0)      as in_house,
      -- Anything that is not a sequel_fee row is third party, null line_type
      -- included: fn 76's conditional has no third branch.
      coalesce(sum(li.fee_amount) filter (
        where li.line_type is distinct from 'sequel_fee'), 0)                    as third_party
    from xano_mirror.invoice_line_items li
    where li.invoice_id = i.id
  ) l
) f
where public.track_is_management()
  and i.status is distinct from 'Archived';

comment on view xano_mirror.management_invoices is
  'One GBP row per live invoice for /management. Management only. Mirrors Xano api 591 + fn 76.';

-- The Projects series counts project rows by the month they were created.
--
-- ⚠️ created_at is TEXT here, an ISO string, and the endpoint's consumer reads
-- its first ten characters. Taking the same ten keeps the month a project
-- lands in identical rather than letting a timezone cast move a late-December
-- row into January.
--
-- ⚠️ Rows with no created_at are the 18 SharePoint placeholder shells (ids
-- 279-299) held open for projects arriving from SharePoint. They are skipped
-- here exactly as the endpoint skips them.
create or replace view xano_mirror.management_projects
with (security_invoker = true) as
select
  p.id,
  left(p.created_at, 10)::date  as created_at,
  p.music_supervisor            as supervisor_id,
  p.brand,
  p.client,
  coalesce(p.brand_category, 0) as category_id
from xano_mirror.project_master_list p
where public.track_is_management()
  and p.status is distinct from 'Archived'
  and nullif(p.created_at, '') is not null;

comment on view xano_mirror.management_projects is
  'Live projects with a creation date, for the /management Projects series. Management only.';

-- Supervisor names for the Team league table. Admin and Sequel only, which is
-- what the endpoint's user_type 1 or 2 means.
create or replace view xano_mirror.management_staff
with (security_invoker = true) as
select u.id, u.name
from xano_mirror."user" u
where public.track_is_management()
  and u.user_type in (1, 2);

comment on view xano_mirror.management_staff is
  'Sequel staff (Admin and Sequel) for the /management Team table. Management only.';

