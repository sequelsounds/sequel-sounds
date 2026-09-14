-- Demos, Wins and Fees for a supplier, off the invoice lines.
--
-- The three tiles on `/partner-edit` and `/roster-edit` have been empty since
-- the day they were made: the pages were duplicated from `/project` and the
-- tiles came with them still bound to `project_service_type`,
-- `project_sequel_no` and `project_status`, which do not exist on a supplier
-- page. Andy's definitions, 14 September 2026:
--
--   Demos — every demo line counts as one.
--   Wins  — how many times they appear on invoice lines with a master or
--           publishing fee. Master AND publishing on the same one counts once.
--   Fees  — the total we have paid them. (Renamed from "Win Fees": it is every
--           line, not only the winning ones.)
--
-- ⚠️ MONEY IS CONVERTED TO GBP HERE, and it has to be. `fee_amount` is in the
-- INVOICE's currency and unmarked, so summing a supplier's lines raw would add
-- yen to euros and produce a confident wrong number. Each line converts at its
-- parent invoice's `exchange_rate_lock` — the rate QuickBooks applied on the
-- day — which is what `management_invoices` does for the same reason. A missing
-- rate is 1, not 0: reporting a line at face value beats silently erasing it.
--
-- ⚠️ `GBP_Amount` on the line items is zero on all 221 rows, so it cannot be
-- used. Lines have no rate of their own and must convert via the parent.
--
-- Excluded: `sequel_fee` rows (Sequel's own margin, `supplier_id` 0 — counting
-- those against a supplier would credit them with Sequel's profit), archived
-- invoices, and lines with no supplier.
create or replace view xano_mirror.supplier_stats
with (security_invoker = true) as
select
  s.id as supplier_id,
  coalesce(a.demos, 0)::bigint as demos,
  coalesce(a.wins, 0)::bigint as wins,
  coalesce(a.fees_gbp, 0)::numeric as fees_gbp,
  -- What Sequel ITSELF paid out, as opposed to what the supplier was paid in
  -- total. A non-paythrough line is settled by the client direct, so this is
  -- far lower and zero for most labels and publishers — Wise Music Creative
  -- reads 265,000 against 0. `fees_gbp` is the tile; this is here so the
  -- distinction stays visible and switching is one word rather than a
  -- migration.
  coalesce(a.fees_paythrough_gbp, 0)::numeric as fees_paythrough_gbp,
  coalesce(a.invoice_count, 0)::bigint as invoice_count
from xano_mirror.supplier_list s
left join (
  -- Grouped ONCE and joined, never a correlated subquery per supplier: RLS
  -- runs inside a correlated subquery, so a per-row lookup here would re-run
  -- the invoice_line_items policy for every supplier on the list. That is the
  -- mistake that made /management's first cut never finish loading.
  select
    li.supplier_id,
    count(*) filter (where li.category = 'Demos') as demos,
    -- Distinct INVOICE, so a master line and a publishing line on the same
    -- invoice are one win rather than two.
    count(distinct li.invoice_id) filter (
      where li.category in ('Library Master', 'Publishing')
    ) as wins,
    sum(li.fee_amount * r.rate) as fees_gbp,
    sum(li.fee_amount * r.rate) filter (where li.is_paythrough) as fees_paythrough_gbp,
    count(distinct li.invoice_id) as invoice_count
  from xano_mirror.invoice_line_items li
  join xano_mirror.invoices i on i.id = li.invoice_id
  cross join lateral (
    select case when coalesce(i.exchange_rate_lock, 0) = 0 then 1 else i.exchange_rate_lock end as rate
  ) r
  where li.line_type is distinct from 'sequel_fee'
    and coalesce(li.supplier_id, 0) > 0
    and i.status is distinct from 'Archived'
  group by li.supplier_id
) a on a.supplier_id = s.id;

grant select on xano_mirror.supplier_stats to authenticated;
