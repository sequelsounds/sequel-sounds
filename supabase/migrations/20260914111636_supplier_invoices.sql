-- The invoices a supplier appears on, one row each.
--
-- This is what fills the tab that used to say "Projects" on `/partner-edit`
-- and `/roster-edit`. On Track that tab has no markup at all — not an empty
-- state, nothing — so there is nothing to copy and this is Andy's shape:
-- invoices rather than projects, because an invoice line is the only place a
-- supplier is actually named. The same lines the Demos / Wins / Fees tiles
-- count, listed out.
--
-- One row per supplier per invoice, so a supplier with a master line and a
-- publishing line on the same invoice appears once — the same dedup the Wins
-- tile uses.
--
-- ⚠️ `supplier_amount` IS IN THE INVOICE'S OWN CURRENCY, with its symbol
-- beside it, exactly as every other invoice row in the app shows money. The
-- Fees TILE above is in sterling, because that one sums across invoices and
-- cannot be. Both are right; the tile carries "(GBP)" so the difference is on
-- screen rather than assumed. `supplier_amount_gbp` is here for anything that
-- needs to total these rows.
--
-- Staff only, matching `invoice_detail` and `invoice_lines` — and matching
-- Track, where the supplier pages are Admin and Sequel accounts only.
create or replace view xano_mirror.supplier_invoices
with (security_invoker = true) as
select
  li.supplier_id,
  i.id as invoice_id,
  i.uuid as invoice_uuid,
  i.invoice_number,
  i.status,
  i.invoice_date,
  i.created_at,
  i.description,
  cb.symbol as currency_symbol,
  cb.currency,
  i.project_master_list_id,
  p.title as project_title,
  p.sequel_no as project_sequel_no,
  -- What THIS supplier is owed on THIS invoice, not the invoice total.
  sum(li.fee_amount) as supplier_amount,
  sum(li.fee_amount * r.rate) as supplier_amount_gbp,
  count(*) as line_count,
  count(*) filter (where li.category = 'Demos') as demo_lines,
  -- Whether this invoice counted as a win for them, by the same test the tile
  -- uses: a Library Master or Publishing line.
  bool_or(li.category in ('Library Master', 'Publishing')) as is_win,
  -- Sequel pays a paythrough line and passes it on; the client settles the
  -- rest direct. Worth showing per row, because it is the difference between
  -- the two money figures on this page.
  bool_or(li.is_paythrough) as any_paythrough
from xano_mirror.invoice_line_items li
join xano_mirror.invoices i on i.id = li.invoice_id
left join xano_mirror.project_master_list p on p.id = i.project_master_list_id
left join xano_mirror.currencies_bank_accounts cb on cb.id = i.currency_id
cross join lateral (
  select case when coalesce(i.exchange_rate_lock, 0) = 0 then 1 else i.exchange_rate_lock end as rate
) r
where li.line_type is distinct from 'sequel_fee'
  and coalesce(li.supplier_id, 0) > 0
  and i.status is distinct from 'Archived'
  and public.track_is_staff()
group by
  li.supplier_id, i.id, i.uuid, i.invoice_number, i.status, i.invoice_date,
  i.created_at, i.description, cb.symbol, cb.currency,
  i.project_master_list_id, p.title, p.sequel_no;

grant select on xano_mirror.supplier_invoices to authenticated;
