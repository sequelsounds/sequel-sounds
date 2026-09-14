-- /dashboard, rebuilt from Xano's dashboard_overview (api 590) and the fee
-- splitter it shares with /management, invoice_fee_breakdown (fn 76).
--
-- ⚠️ THIS DUPLICATES management_invoices ON PURPOSE, and the two must change
-- together. Xano makes the same choice and says why: "deliberately separate
-- endpoints rather than one with a flag, so a bug in a filter can never leak
-- company totals onto the personal page". A shared, ungated base view would
-- put every supervisor's profit one select away from a staff account that is
-- not management. The cost is that a change to the fee buckets has to land in
-- both — the fee arithmetic below is fn 76's and nothing else may invent it.
--
-- ⚠️ STAFF ONLY, AND ONLY YOUR OWN. Filtered on music_supervisor_id against
-- the caller, which is WHOEVER RAISED THE INVOICE, not whoever owns the
-- project today. Jobs change hands. This reports billing, not ownership.
--
-- EVERY YEAR, unlike the endpoint's totals: the Revenue and Projects charts
-- plot this year against last, and the browser scopes the stat bar. Track
-- scopes its totals in Xano instead, because it does the sums there; doing it
-- here would blank last year's line.
create or replace view xano_mirror.dashboard_invoices
with (security_invoker = true) as
select
  i.id,
  i.uuid,
  i.invoice_number,
  coalesce(p.title, '')                              as project_title,
  i.invoice_date,
  i.status,
  i.music_supervisor_id                              as supervisor_id,
  i.client_id,
  coalesce(cl.company, '')                           as client_name,
  -- ⚠️ No per-row rounding: the page rounds once, for display. See the note
  -- on management_invoices — rounding here moved a total by a pound.
  coalesce(i.total_to_invoice, 0) * r.rate           as invoiced,
  f.sequel_total * r.rate                            as profit,
  coalesce(i.gross_spend, 0) * r.rate                as spend,
  f.third_party * r.rate                             as third_party,
  f.studios * r.rate                                 as studios,
  f.demo * r.rate                                    as demo,
  f.search * r.rate                                  as search,
  f.licence * r.rate                                 as licence,
  f.other * r.rate                                   as other,
  -- In no total. It records money that did not move — and the stat bar's
  -- Avoidance figure is the only thing that reads it.
  ( coalesce(i.demo_cost_avoidance, 0)
  + coalesce(i.search_cost_avoidance, 0)
  + coalesce(i.master_cost_avoidance, 0)
  + coalesce(i.publishing_cost_avoidance, 0)
  + coalesce(i.other_cost_avoidance, 0) ) * r.rate   as cost_avoidance
from xano_mirror.invoices i
cross join lateral (
  -- A missing rate is 1, not zero: reporting an invoice at face value beats
  -- silently erasing it. ⚠️ exchange_rate_lock, never gbp_total_amount and
  -- never eur_rate.
  select case when coalesce(i.exchange_rate_lock, 0) = 0
              then 1::numeric else i.exchange_rate_lock end as rate
) r
left join xano_mirror.project_master_list p on p.id = i.project_master_list_id
left join xano_mirror.clients            cl on cl.id = i.client_id
-- ⚠️ Grouped once, not a correlated scan per invoice: RLS runs inside that
-- scan and the page never finishes loading. Same lesson as /management.
left join (
  select
    li.invoice_id,
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
    coalesce(sum(li.fee_amount) filter (
      where li.line_type is distinct from 'sequel_fee'), 0)                    as third_party
  from xano_mirror.invoice_line_items li
  group by li.invoice_id
) lines on lines.invoice_id = i.id
cross join lateral (
  select
    h.demo + l.demo       as demo,
    h.search + l.search   as search,
    h.licence + l.licence as licence,
    h.studios + l.studios as studios,
    h.other + l.other     as other,
    h.demo + l.demo + h.search + l.search + h.licence + l.licence
      + h.studios + l.studios + h.other + l.other + l.in_house as sequel_total,
    l.third_party         as third_party
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
  cross join (
    select
      coalesce(lines.demo, 0)        as demo,
      coalesce(lines.search, 0)      as search,
      coalesce(lines.licence, 0)     as licence,
      coalesce(lines.studios, 0)     as studios,
      coalesce(lines.other, 0)       as other,
      coalesce(lines.in_house, 0)    as in_house,
      coalesce(lines.third_party, 0) as third_party
  ) l
) f
where public.track_is_staff()
  and i.music_supervisor_id = public.track_user_id()
  and i.status is distinct from 'Archived';

comment on view xano_mirror.dashboard_invoices is
  'The caller''s own live invoices in GBP, every year, for /dashboard. Staff only. Mirrors Xano api 590 + fn 76.';

-- The Projects series counts the caller's projects by the month they were
-- logged.
--
-- ⚠️ created_at_dup2, NOT created_at — the text column of that name on Project
-- Master List is not a Xano timestamp. Same trap as management_projects.
-- ⚠️ created_at is WHEN THE PROJECT WAS LOGGED, not when the work happened.
create or replace view xano_mirror.dashboard_projects
with (security_invoker = true) as
select
  p.id,
  p.created_at_dup2 as created_at
from xano_mirror.project_master_list p
where public.track_is_staff()
  and p.music_supervisor = public.track_user_id()
  and p.status is distinct from 'Archived'
  and p.created_at_dup2 is not null;

comment on view xano_mirror.dashboard_projects is
  'The caller''s own live projects with a creation date, for the /dashboard Projects series. Staff only.';

grant select on xano_mirror.dashboard_invoices to authenticated;
grant select on xano_mirror.dashboard_projects to authenticated;

