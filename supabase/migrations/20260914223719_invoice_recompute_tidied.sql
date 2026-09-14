-- Mirrors Xano's fn 52, including the half of model B that is live: Sequel fees
-- come from the nine header columns AND from any `sequel_fee` rows. Ten
-- historic invoices carry their demo contingency as a row with the column at
-- zero, and fn 52 is what puts that money into their totals.
--
-- ⚠️ THE THREE TOTALS ARE NOT INTERCHANGEABLE (invoicing doc §2.2):
--   total to invoice = all Sequel fees + PAYTHROUGH third-party rows only
--   total spend      = all Sequel fees + EVERY third-party row
--   profit           = all Sequel fees, no third-party rows
--
-- ⚠️ `is_paythrough` is meaningless on a fee row — the branch is on line_type,
-- exactly as fn 52 does it. Setting the flag on fee rows to make the invoice
-- total one flat filter was considered and rejected: a single row with the flag
-- wrong would drop money off an invoice with nothing on screen to explain it.
--
-- ⚠️ COST AVOIDANCE IS ABSENT FROM ALL THREE, deliberately. It is money that
-- did not move. Putting it in spend would inflate 2026 by roughly 1.57m across
-- currencies. Its absence here is the safety property, not an omission.
create or replace function public.track_recompute_invoice_totals(p_invoice_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_header_fees numeric := 0;
  v_row_fees    numeric := 0;
  v_paythru     numeric := 0;
  v_third       numeric := 0;
  v_fees        numeric := 0;
begin
  select
    coalesce(i.demo_contingency_fee, 0) + coalesce(i.sequel_demo_fee, 0)
    + coalesce(i.search_contingency_fee, 0) + coalesce(i.sequel_search_fee, 0)
    + coalesce(i.master_sequel_studios_fee, 0) + coalesce(i.master_sequel_licence_fee, 0)
    + coalesce(i.publishing_sequel_studios_fee, 0) + coalesce(i.publishing_sequel_licence_fee, 0)
    + coalesce(i.sequel_consultancy_fee, 0)
  into v_header_fees
  from xano_mirror.invoices i
  where i.id = p_invoice_id;

  select
    coalesce(sum(l.fee_amount) filter (where l.line_type = 'sequel_fee'), 0),
    coalesce(sum(l.fee_amount) filter (where coalesce(l.line_type, 'third_party') <> 'sequel_fee'), 0),
    coalesce(sum(l.fee_amount) filter (
      where coalesce(l.line_type, 'third_party') <> 'sequel_fee' and l.is_paythrough
    ), 0)
  into v_row_fees, v_third, v_paythru
  from xano_mirror.invoice_line_items l
  where l.invoice_id = p_invoice_id;

  v_fees := v_header_fees + v_row_fees;

  update xano_mirror.invoices i
     set total_to_invoice    = v_fees + v_paythru,
         gross_spend         = v_fees + v_third,
         total_sequel_profit = v_fees
   where i.id = p_invoice_id;
end
$function$;

revoke all on function public.track_recompute_invoice_totals(bigint) from public, anon, authenticated;
