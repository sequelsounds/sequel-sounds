-- The finance review page, `/invoice`, read-only.
--
-- Track restricts this page to Admin and Sequel accounts (`assert_sequel_staff`),
-- so both views ask `track_is_staff()`. A client user who can reach the project
-- cannot reach its invoices here, which is the same split Track draws.
--
-- ⚠️ EVERY MONEY FIGURE HERE IS IN THE INVOICE'S OWN CURRENCY, not sterling.
-- `total_sequel_profit`, `total_to_invoice` and `gross_spend` are local and
-- unmarked in Xano, and the reporting views convert with `exchange_rate_lock`
-- where they need to. This page shows one invoice, with its symbol beside the
-- number, so it does not convert — the same choice Track makes.

create or replace view xano_mirror.invoice_detail
with (security_invoker = true) as
with fee_rows as (
  -- The `sequel_fee` rows, folded back into the nine columns the page shows.
  --
  -- This reproduces the read shim in Xano's `get_invoice_by_uuid` (568), and it
  -- is not optional: ten historic invoices carry their demo contingency as a
  -- ROW with the header column at zero, and without this projection those
  -- amounts are simply missing from the boxes while still counting in the
  -- totals. Mapping from `sequel-track-invoicing.md` §2.5.1.
  select
    li.invoice_id,
    -- Within Demos and Searches the split is contingency / everything else.
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Demos' and li.fee_type = 'contingency'), 0) as demo_contingency,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Demos' and li.fee_type is distinct from 'contingency'), 0) as demo,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Searches' and li.fee_type = 'contingency'), 0) as search_contingency,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Searches' and li.fee_type is distinct from 'contingency'), 0) as search,
    -- Within Library Master and Publishing it is licence / everything else.
    -- ⚠️ The two licence fees DO NOT MERGE — they are two fields, like the two
    -- studios fees, and an earlier version of the Xano shim folded both into
    -- master and left publishing at zero. `Licence` is a leftover category
    -- value nothing writes; it lands in master as a defensive fallback so a
    -- stray row cannot vanish off the screen while still counting in a total.
    coalesce(sum(li.fee_amount) filter (
      where (li.category = 'Library Master' and li.fee_type = 'licence')
         or li.category = 'Licence'), 0) as master_licence,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Library Master' and li.fee_type is distinct from 'licence'), 0) as master_studios,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Publishing' and li.fee_type = 'licence'), 0) as publishing_licence,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Publishing' and li.fee_type is distinct from 'licence'), 0) as publishing_studios,
    coalesce(sum(li.fee_amount) filter (
      where li.category = 'Other Fees'), 0) as consultancy,
    count(*) as fee_row_count
  from xano_mirror.invoice_line_items li
  where li.line_type = 'sequel_fee'
  group by li.invoice_id
)
select
  i.id,
  i.uuid,
  i.invoice_number,
  i.status,
  i.description,
  i.invoice_date,
  i.due_date,
  i.created_at,
  i.po_number,
  i.po_attachment_url,
  i.aws_link,
  i.adpro_number,
  i.usage_territories,
  i.usage_region,
  i.song_name,
  i.artist_name,

  -- `locked` is one flag computed from one column, exactly as 568 returns it.
  -- Track keys every read-only state on the page off this single boolean so
  -- the screen and the endpoints can never disagree about whether an invoice
  -- can still be edited. Nothing here writes yet, but the flag is what a
  -- future edit path will gate on, and the banner reads from it today.
  (coalesce(i.qbo_invoice_id, '') <> '') as locked,
  i.qbo_invoice_id,

  i.project_master_list_id,
  p.uuid as project_uuid,
  p.title as project_title,
  p.sequel_no as project_sequel_no,

  i.client_id,
  cl.company as client_name,
  i.music_supervisor_id,
  u.name as music_supervisor,

  i.currency_id,
  cb.currency,
  cb.symbol as currency_symbol,
  -- local x rate = GBP. A missing rate is 1, not 0 — reporting an invoice at
  -- face value beats silently erasing it, and that is what the endpoints do.
  case when coalesce(i.exchange_rate_lock, 0) = 0 then 1 else i.exchange_rate_lock end as exchange_rate,
  i.gbp_total_amount,

  -- The nine fee boxes: column + any rows that project into it.
  coalesce(i.demo_contingency_fee, 0)         + coalesce(f.demo_contingency, 0)   as demo_contingency_fee,
  coalesce(i.sequel_demo_fee, 0)              + coalesce(f.demo, 0)               as sequel_demo_fee,
  coalesce(i.search_contingency_fee, 0)       + coalesce(f.search_contingency, 0) as search_contingency_fee,
  coalesce(i.sequel_search_fee, 0)            + coalesce(f.search, 0)             as sequel_search_fee,
  coalesce(i.master_sequel_studios_fee, 0)    + coalesce(f.master_studios, 0)     as master_sequel_studios_fee,
  coalesce(i.master_sequel_licence_fee, 0)    + coalesce(f.master_licence, 0)     as master_sequel_licence_fee,
  coalesce(i.publishing_sequel_studios_fee, 0)+ coalesce(f.publishing_studios, 0) as publishing_sequel_studios_fee,
  coalesce(i.publishing_sequel_licence_fee, 0)+ coalesce(f.publishing_licence, 0) as publishing_sequel_licence_fee,
  coalesce(i.sequel_consultancy_fee, 0)       + coalesce(f.consultancy, 0)        as sequel_consultancy_fee,
  -- So a reader can tell a folded box from a plain one.
  coalesce(f.fee_row_count, 0) as fee_row_count,

  -- Cost avoidance: what the client was saved against the original quote.
  -- ⚠️ MONEY THAT DID NOT MOVE. It is a reporting figure and nothing else, and
  -- it must never reach any of the three totals — Xano's fn 52 deliberately
  -- does not read these columns, and adding them to spend would inflate 2026
  -- by roughly 1.57m across currencies.
  coalesce(i.demo_cost_avoidance, 0) as demo_cost_avoidance,
  coalesce(i.search_cost_avoidance, 0) as search_cost_avoidance,
  coalesce(i.master_cost_avoidance, 0) as master_cost_avoidance,
  coalesce(i.publishing_cost_avoidance, 0) as publishing_cost_avoidance,
  coalesce(i.other_cost_avoidance, 0) as other_cost_avoidance,
  ( coalesce(i.demo_cost_avoidance, 0)
  + coalesce(i.search_cost_avoidance, 0)
  + coalesce(i.master_cost_avoidance, 0)
  + coalesce(i.publishing_cost_avoidance, 0)
  + coalesce(i.other_cost_avoidance, 0)) as total_cost_avoidance,

  -- The three totals, derived server-side by Xano's fn 52 and stored. This
  -- page displays them and calculates nothing: four separate bugs on the
  -- create form came from a screen and a stored value each implementing the
  -- same sum slightly differently.
  --   total to invoice = all Sequel fees + paythrough third-party rows only
  --   total spend      = all Sequel fees + every third-party row
  --   profit           = all Sequel fees, no third-party rows
  coalesce(i.total_to_invoice, 0) as total_to_invoice,
  coalesce(i.gross_spend, 0) as gross_spend,
  coalesce(i.total_sequel_profit, 0) as total_sequel_profit
from xano_mirror.invoices i
left join xano_mirror.project_master_list p on p.id = i.project_master_list_id
left join xano_mirror.clients cl on cl.id = i.client_id
left join xano_mirror."user" u on u.id = i.music_supervisor_id
left join xano_mirror.currencies_bank_accounts cb on cb.id = i.currency_id
left join fee_rows f on f.invoice_id = i.id
where public.track_is_staff();

grant select on xano_mirror.invoice_detail to authenticated;

-- The supplier cost rows.
--
-- ⚠️ `sequel_fee` rows are filtered OUT, as Xano's 568 shim filters them out of
-- `lines[]`. They are Sequel's own margin and rendering them as supplier costs
-- would both double them on screen and invite someone to give one a supplier —
-- which is the exact condition that lets Sequel's margin acquire a
-- `qbo_vendor_id` and be billed as a third party. They are shown in the fee
-- boxes instead, folded in by `invoice_detail`.
create or replace view xano_mirror.invoice_lines
with (security_invoker = true) as
select
  li.id,
  li.invoice_id,
  i.uuid as invoice_uuid,
  li.category,
  li.supplier_id,
  s.title as supplier,
  li.fee_amount,
  li.is_paythrough,
  li.confirmed,
  li.qbo_bill_id,
  li.share_percent,
  li.fee_type,
  li.line_type
from xano_mirror.invoice_line_items li
join xano_mirror.invoices i on i.id = li.invoice_id
left join xano_mirror.supplier_list s on s.id = li.supplier_id
where li.line_type is distinct from 'sequel_fee'
  and public.track_is_staff();

grant select on xano_mirror.invoice_lines to authenticated;

-- The project page's invoice list had no uuid, so its rows had nothing to link
-- to. Track's rows open `/invoice?uuid=`. Dropped and recreated rather than
-- replaced: `create or replace view` cannot insert a column in the middle.
drop view xano_mirror.project_invoices;

create view xano_mirror.project_invoices
with (security_invoker = true) as
select
  i.id,
  i.uuid,
  i.project_master_list_id,
  i.description,
  i.invoice_number,
  i.status,
  i.invoice_date,
  i.due_date,
  cb.currency,
  c.company as client,
  u.name as music_supervisor,
  i.song_name,
  i.artist_name,
  i.total_to_invoice as total_amount,
  i.gbp_total_amount as total_gbp_amount,
  i.gross_spend as gross_spend_amount,
  i.total_sequel_profit as sequel_profit_amount,
  i.po_number,
  i.aws_link,
  i.qbo_invoice_id,
  i.created_at,
  cb.symbol as currency_symbol
from xano_mirror.invoices i
left join xano_mirror.clients c on c.id = i.client_id
left join xano_mirror."user" u on u.id = i.music_supervisor_id
left join xano_mirror.currencies_bank_accounts cb on cb.id = i.currency_id;

grant select on xano_mirror.project_invoices to authenticated;
