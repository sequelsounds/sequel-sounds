-- 15 Sep 2026. Andy: "the current xano, wized and webflow setup is correct so
-- copy what that is doing."
--
-- track_recompute_invoice_totals now does exactly what Xano's
-- recompute_invoice_totals (fn 52, read 15 Sep) does. The 14 Sep version had
-- three gaps against it:
--
--   1. license_contingency_fee and other_contingency_fee were missing from the
--      header fee sum. Xano added them on 4 Sep.
--   2. total_third_party_fees and total_service_fees — the Unilever split —
--      were never written.
--   3. eur_rate was never stamped. Xano copies it from the currency while the
--      invoice is not yet in QuickBooks, and freezes it after.
--
-- CHECKED BEFORE APPLYING: this arithmetic, run as a query over all 158 mirror
-- invoices, reproduces the stored total_to_invoice, gross_spend and
-- total_sequel_profit on all 158, and total_third_party_fees and
-- total_service_fees on all 156 that Xano wrote. The two it did not match were
-- 1000 and 1001, created by the new app, which never wrote the split. This
-- migration recomputes those two.
--
-- The rules, as fn 52 states them:
--   total to invoice = all Sequel fees + paythrough third-party lines only
--   gross spend      = all Sequel fees + every third-party line
--   profit           = all Sequel fees, no third-party lines
--   third party      = every third-party line + both studio fees
--                      + all four contingency columns
--                      + contingency and studios fee ROWS
--   service          = all Sequel fees - the studio and contingency part
-- Cost avoidance is in none of them.
--
-- ⚠️ total_service_fees IS NOT profit. Profit includes studio and contingency;
-- the Unilever figure does not. Never substitute one for the other.
-- ⚠️ INVARIANT: third party + service = gross spend.

create or replace function public.track_recompute_invoice_totals(p_invoice_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_inv         xano_mirror.invoices;
  v_header_fees numeric := 0;
  v_header_tp   numeric := 0;
  v_row_fees    numeric := 0;
  v_row_fees_tp numeric := 0;
  v_third       numeric := 0;
  v_paythru     numeric := 0;
  v_fees        numeric := 0;
  v_eur_rate    numeric;
begin
  select * into v_inv from xano_mirror.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  -- Every Sequel fee held as a column, studio fees and all four contingency
  -- columns included.
  v_header_fees :=
      coalesce(v_inv.demo_contingency_fee, 0) + coalesce(v_inv.search_contingency_fee, 0)
    + coalesce(v_inv.license_contingency_fee, 0) + coalesce(v_inv.other_contingency_fee, 0)
    + coalesce(v_inv.sequel_demo_fee, 0) + coalesce(v_inv.sequel_search_fee, 0)
    + coalesce(v_inv.master_sequel_studios_fee, 0) + coalesce(v_inv.master_sequel_licence_fee, 0)
    + coalesce(v_inv.publishing_sequel_studios_fee, 0) + coalesce(v_inv.publishing_sequel_licence_fee, 0)
    + coalesce(v_inv.sequel_consultancy_fee, 0);

  -- The part of those Unilever count as third party.
  v_header_tp :=
      coalesce(v_inv.demo_contingency_fee, 0) + coalesce(v_inv.search_contingency_fee, 0)
    + coalesce(v_inv.license_contingency_fee, 0) + coalesce(v_inv.other_contingency_fee, 0)
    + coalesce(v_inv.master_sequel_studios_fee, 0) + coalesce(v_inv.publishing_sequel_studios_fee, 0);

  -- ⚠️ The branch is on line_type, as fn 52 does it; is_paythrough means
  -- nothing on a fee row. A null line_type is a third-party line.
  select
    coalesce(sum(l.fee_amount) filter (where l.line_type = 'sequel_fee'), 0),
    coalesce(sum(l.fee_amount) filter (
      where l.line_type = 'sequel_fee' and l.fee_type in ('contingency', 'studios')
    ), 0),
    coalesce(sum(l.fee_amount) filter (where l.line_type is distinct from 'sequel_fee'), 0),
    coalesce(sum(l.fee_amount) filter (
      where l.line_type is distinct from 'sequel_fee' and l.is_paythrough
    ), 0)
  into v_row_fees, v_row_fees_tp, v_third, v_paythru
  from xano_mirror.invoice_line_items l
  where l.invoice_id = p_invoice_id;

  v_fees := v_header_fees + v_row_fees;

  -- eur_rate follows the currency until the invoice is in QuickBooks, then
  -- freezes: Unilever revise their rates, and a report regenerated later must
  -- reproduce the figures they were sent. Not exchange_rate_lock, which is
  -- QuickBooks' market rate and set elsewhere.
  v_eur_rate := v_inv.eur_rate;
  if coalesce(v_inv.qbo_invoice_id, '') = '' then
    select coalesce(c.eur_rate, v_eur_rate) into v_eur_rate
      from xano_mirror.currencies_bank_accounts c
     where c.id = v_inv.currency_id;
    v_eur_rate := coalesce(v_eur_rate, v_inv.eur_rate);
  end if;

  update xano_mirror.invoices i
     set total_to_invoice       = v_fees + v_paythru,
         gross_spend            = v_fees + v_third,
         total_sequel_profit    = v_fees,
         total_third_party_fees = v_third + v_header_tp + v_row_fees_tp,
         total_service_fees     = v_fees - v_header_tp - v_row_fees_tp,
         eur_rate               = v_eur_rate
   where i.id = p_invoice_id;
end
$function$;

revoke all on function public.track_recompute_invoice_totals(bigint) from public, anon, authenticated;

-- The create path worked its totals out inline, a second copy of the same sum
-- — the thing fn 52 exists to prevent. It now calls the recompute. Patched in
-- the live definition rather than restated, so nothing else in the function
-- can drift from what is deployed; the assertion refuses if the block is not
-- found exactly once.
do $migration$
declare
  v_def  text;
  v_new  text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'track_create_invoice_request';

  v_new := regexp_replace(
    v_def,
    'update xano_mirror\.invoices i\s+set total_to_invoice\s+= v_fees \+ v_paythru,\s+gross_spend\s+= v_fees \+ v_third,\s+total_sequel_profit = v_fees\s+where i\.id = v_invoice_id;',
    'perform public.track_recompute_invoice_totals(v_invoice_id);'
  );

  if v_new = v_def then
    raise exception 'track_create_invoice_request: totals block not found, nothing changed';
  end if;
  if position('perform public.track_recompute_invoice_totals(v_invoice_id);' in v_new) = 0
     or position('update xano_mirror.invoices i' in v_new) > 0 then
    raise exception 'track_create_invoice_request: patch did not apply cleanly';
  end if;

  execute v_new;
end
$migration$;

-- The two invoices the new app created before this.
select public.track_recompute_invoice_totals(id)
  from xano_mirror.invoices
 where id in (1000, 1001);
