-- ⚠️ NO PER-ROW ROUNDING. An earlier cut of this view rounded each invoice to
-- the penny before the browser summed it, and Knorr's 2026 invoiced total then
-- read £62,121 against Track's £62,120: twenty-two roundings nudged a
-- 62,120.489 sum over the half-penny line. The page rounds once, for display,
-- exactly as Track does, so the rows leave here at full precision.
create or replace view xano_mirror.management_invoices
with (security_invoker = true) as
select
  i.id,
  i.uuid,
  i.invoice_number,
  coalesce(p.title, '')                              as project_title,
  coalesce(p.brand, '')                              as brand,
  coalesce(p.brand_category, 0)                      as category_id,
  -- "Unclassified" and "Unassigned" are real reported values, not blanks.
  coalesce(bc.category, 'Unclassified')              as category,
  coalesce(ag.company, '')                           as agency,
  coalesce(rg.region, 'Unassigned')                  as region,
  coalesce(p.client, 0) = 1                          as is_unilever,
  i.invoice_date,
  i.status,
  i.music_supervisor_id                              as supervisor_id,
  i.client_id,
  coalesce(cl.company, '')                           as client_name,
  coalesce(i.total_to_invoice, 0) * r.rate           as invoiced,
  f.sequel_total * r.rate                            as profit,
  coalesce(i.gross_spend, 0) * r.rate                as spend,
  f.third_party * r.rate                             as third_party,
  f.studios * r.rate                                 as studios,
  f.demo * r.rate                                    as demo,
  f.search * r.rate                                  as search,
  f.licence * r.rate                                 as licence,
  f.other * r.rate                                   as other,
  ( coalesce(i.demo_cost_avoidance, 0)
  + coalesce(i.search_cost_avoidance, 0)
  + coalesce(i.master_cost_avoidance, 0)
  + coalesce(i.publishing_cost_avoidance, 0)
  + coalesce(i.other_cost_avoidance, 0) ) * r.rate   as cost_avoidance
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
    h.demo + l.demo       as demo,
    h.search + l.search   as search,
    h.licence + l.licence as licence,
    h.studios + l.studios as studios,
    h.other + l.other     as other,
    l.in_house            as in_house,
    l.third_party         as third_party,
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
  'One GBP row per live invoice for /management, at full precision. Management only. Mirrors Xano api 591 + fn 76.';

