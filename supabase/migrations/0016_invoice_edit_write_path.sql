-- Applied to the remote as 20260914223658_invoice_edit_write_path and
-- 20260914223719_invoice_recompute_tidied. This file is the FINAL state of
-- both; the first version of the recompute assigned v_fees three times and was
-- rewritten before anything depended on it.
--
-- Editing an invoice on /invoice: the header, the nine fee boxes, the five cost
-- avoidance boxes, and the supplier lines.
--
-- ⚠️ THE RAISE FLOW IS NOT HERE AND IS NOT AN OVERSIGHT. Raising creates a
-- financial record in QuickBooks. It does not belong on a page that cannot yet
-- be trusted to edit one, and bills cannot be raised automatically at all until
-- the supplier-currency gap is settled (invoicing doc §7B.4).
--
-- ⚠️ TOTALS ARE DERIVED, NEVER SENT. Every write ends in
-- track_recompute_invoice_totals. Four separate bugs on the old form came from
-- a screen and a stored value each implementing the same sum differently.
--
-- ⚠️ NULL MEANS "NOT SUPPLIED", the column means the value. Every input is
-- nullable with no default and falls back to what is stored. Xano's optional
-- inputs default to 0 and "" instead, and a request fired before the page had
-- loaded once wiped 100/200/300/400/500 of cost avoidance off invoice 137. A
-- genuine 0 still saves, because 0 is not null.

-- ---------------------------------------------------------------- recompute
-- Mirrors Xano's fn 52, including the half of model B that is live: Sequel fees
-- come from the nine header columns AND from any `sequel_fee` rows. Ten
-- historic invoices carry their demo contingency as a row with the column at
-- zero, and fn 52 is what puts that money into their totals.
--
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
--
-- Verified 14 Sep against invoices 145, 151 and 163 — all three carry fee rows,
-- and the arithmetic below reproduces their stored totals exactly, including
-- 145's 24,500 header + 1,250 row = 25,750 profit.
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

-- --------------------------------------------------------------- the guards
create or replace function public.track_invoice_editable(p_invoice_id bigint)
returns xano_mirror.invoices
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare v_inv xano_mirror.invoices;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can edit an invoice.' using errcode = '42501';
  end if;

  select * into v_inv from xano_mirror.invoices where id = p_invoice_id;
  if v_inv.id is null then
    raise exception 'No such invoice.' using errcode = 'P0002';
  end if;

  -- ⚠️ One flag, one meaning. Once an invoice is in QuickBooks it is a
  -- financial record and nothing here may touch it. The screen hides its own
  -- controls off the same flag, and this refuses independently so a stale tab
  -- cannot get through.
  if coalesce(v_inv.qbo_invoice_id, '') <> '' then
    raise exception 'That invoice is already in QuickBooks and can no longer be changed.'
      using errcode = '42501';
  end if;

  return v_inv;
end
$function$;

-- ---------------------------------------------------------------- the header
create or replace function public.track_update_invoice(
  p_invoice_id        bigint,
  p_description       text    default null,
  p_po_number         text    default null,
  p_po_attachment_url text    default null,
  p_song_name         text    default null,
  p_artist_name       text    default null,
  p_usage_territories text    default null,
  p_usage_region      text    default null,
  p_client_id         bigint  default null,
  p_currency_id       bigint  default null,
  p_fees              jsonb   default null
)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_inv xano_mirror.invoices;
  v_fee_rows int;
  v_allowed_regions text[] := array[
    'Africa', 'Asia', 'Europe', 'Global', 'Latin America',
    'NAMET & RUB', 'North America', 'North Asia', 'SEAA', 'South Asia'
  ];
begin
  v_inv := public.track_invoice_editable(p_invoice_id);

  if p_usage_region is not null and btrim(p_usage_region) <> ''
     and not (p_usage_region = any(v_allowed_regions)) then
    raise exception 'Unknown usage region: %', p_usage_region using errcode = '23514';
  end if;

  -- ⚠️ THE ROUND-TRIP DOUBLE COUNT. `invoice_detail` shows each fee box as its
  -- header column PLUS any `sequel_fee` rows folded in. Writing that displayed
  -- figure back to the column while the row still exists counts the money
  -- twice — on invoice 1017 it would move profit from 25,750 to 27,000.
  --
  -- The invoicing doc's recommendation (§2.5.5) is to leave the two shapes
  -- alone and make the split safe rather than finish model B. This is that
  -- guard. ⚠️ IT IS UNEXERCISED: all ten invoices carrying fee rows are already
  -- in QuickBooks and are refused above, so this branch has never run. It makes
  -- a latent bug impossible rather than merely unlikely.
  if p_fees is not null then
    select count(*) into v_fee_rows
    from xano_mirror.invoice_line_items
    where invoice_id = p_invoice_id and line_type = 'sequel_fee';

    if v_fee_rows > 0 then
      raise exception
        'This invoice holds its Sequel fees as line rows, so the fee boxes cannot be edited here.'
        using errcode = '42501';
    end if;
  end if;

  update xano_mirror.invoices i set
    description       = coalesce(p_description, i.description),
    po_number         = coalesce(nullif(btrim(coalesce(p_po_number, '')), ''), p_po_number, i.po_number),
    po_attachment_url = coalesce(p_po_attachment_url, i.po_attachment_url),
    song_name         = coalesce(p_song_name, i.song_name),
    artist_name       = coalesce(p_artist_name, i.artist_name),
    usage_territories = coalesce(p_usage_territories, i.usage_territories),
    usage_region      = coalesce(nullif(btrim(coalesce(p_usage_region, '')), ''), i.usage_region),
    -- ⚠️ Identity fields never take a zero. A request fired before the page had
    -- loaded once blanked a status to an empty string and zeroed both foreign
    -- keys on the old stack.
    client_id         = coalesce(nullif(p_client_id, 0)::int, i.client_id),
    currency_id       = coalesce(nullif(p_currency_id, 0)::int, i.currency_id),

    demo_contingency_fee          = coalesce((p_fees ->> 'demo_contingency_fee')::numeric, i.demo_contingency_fee),
    sequel_demo_fee               = coalesce((p_fees ->> 'sequel_demo_fee')::numeric, i.sequel_demo_fee),
    search_contingency_fee        = coalesce((p_fees ->> 'search_contingency_fee')::numeric, i.search_contingency_fee),
    sequel_search_fee             = coalesce((p_fees ->> 'sequel_search_fee')::numeric, i.sequel_search_fee),
    master_sequel_studios_fee     = coalesce((p_fees ->> 'master_sequel_studios_fee')::numeric, i.master_sequel_studios_fee),
    master_sequel_licence_fee     = coalesce((p_fees ->> 'master_sequel_licence_fee')::numeric, i.master_sequel_licence_fee),
    publishing_sequel_studios_fee = coalesce((p_fees ->> 'publishing_sequel_studios_fee')::numeric, i.publishing_sequel_studios_fee),
    publishing_sequel_licence_fee = coalesce((p_fees ->> 'publishing_sequel_licence_fee')::numeric, i.publishing_sequel_licence_fee),
    sequel_consultancy_fee        = coalesce((p_fees ->> 'sequel_consultancy_fee')::numeric, i.sequel_consultancy_fee),

    demo_cost_avoidance       = coalesce((p_fees ->> 'demo_cost_avoidance')::numeric, i.demo_cost_avoidance),
    search_cost_avoidance     = coalesce((p_fees ->> 'search_cost_avoidance')::numeric, i.search_cost_avoidance),
    master_cost_avoidance     = coalesce((p_fees ->> 'master_cost_avoidance')::numeric, i.master_cost_avoidance),
    publishing_cost_avoidance = coalesce((p_fees ->> 'publishing_cost_avoidance')::numeric, i.publishing_cost_avoidance),
    other_cost_avoidance      = coalesce((p_fees ->> 'other_cost_avoidance')::numeric, i.other_cost_avoidance)
  where i.id = p_invoice_id;

  perform public.track_recompute_invoice_totals(p_invoice_id);
end
$function$;

-- ----------------------------------------------------------------- the lines
create or replace function public.track_add_invoice_line(
  p_invoice_id bigint,
  p_category   text default 'Demos'
)
returns bigint
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_inv xano_mirror.invoices;
  v_id  bigint;
begin
  v_inv := public.track_invoice_editable(p_invoice_id);

  insert into xano_mirror.invoice_line_items
    (invoice_id, supplier_id, category, line_type, currency, fee_amount, is_paythrough, created_at)
  values
    (p_invoice_id, null, p_category, 'third_party', v_inv.currency_id, 0, true, now())
  returning id into v_id;

  perform public.track_recompute_invoice_totals(p_invoice_id);
  return v_id;
end
$function$;

create or replace function public.track_update_invoice_line(
  p_line_id       bigint,
  p_supplier_id   bigint  default null,
  p_amount        numeric default null,
  p_category      text    default null,
  p_is_paythrough boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare v_line xano_mirror.invoice_line_items;
begin
  select * into v_line from xano_mirror.invoice_line_items where id = p_line_id;
  if v_line.id is null then
    raise exception 'No such line.' using errcode = 'P0002';
  end if;
  perform public.track_invoice_editable(v_line.invoice_id);

  -- ⚠️ A `sequel_fee` ROW IS NOT A SUPPLIER COST AND MUST NOT BE EDITED HERE.
  -- This function writes supplier_id, category and is_paythrough; applied to a
  -- fee row it would give Sequel's own margin a supplier id — the exact
  -- condition that lets it acquire a QuickBooks vendor id and be billed to a
  -- third party. A Sequel fee is cleared by setting its box to zero, which
  -- ZEROES THE ROW rather than deleting it: anything touching money is easier
  -- to explain later if the record is still there. A zero-value fee row is
  -- expected and correct; do not tidy them away.
  if v_line.line_type = 'sequel_fee' then
    raise exception 'That line is a Sequel fee. Change it in its fee box instead.'
      using errcode = '42501';
  end if;

  update xano_mirror.invoice_line_items l set
    supplier_id   = coalesce(nullif(p_supplier_id, 0)::int, l.supplier_id),
    fee_amount    = coalesce(p_amount, l.fee_amount),
    category      = coalesce(nullif(btrim(coalesce(p_category, '')), ''), l.category),
    is_paythrough = coalesce(p_is_paythrough, l.is_paythrough)
  where l.id = p_line_id;

  perform public.track_recompute_invoice_totals(v_line.invoice_id);
end
$function$;

create or replace function public.track_delete_invoice_line(p_line_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare v_line xano_mirror.invoice_line_items;
begin
  select * into v_line from xano_mirror.invoice_line_items where id = p_line_id;
  if v_line.id is null then return; end if;
  perform public.track_invoice_editable(v_line.invoice_id);

  if v_line.line_type = 'sequel_fee' then
    raise exception 'That line is a Sequel fee. Set its fee box to zero instead.'
      using errcode = '42501';
  end if;

  delete from xano_mirror.invoice_line_items where id = p_line_id;
  perform public.track_recompute_invoice_totals(v_line.invoice_id);
end
$function$;

-- ⚠️ The two helpers are NOT callable by `authenticated`. Recompute writes the
-- three totals and takes no view of who is asking, so exposing it would let any
-- signed-in account rewrite an invoice's money with one call.
revoke all on function public.track_recompute_invoice_totals(bigint) from public, anon, authenticated;
revoke all on function public.track_invoice_editable(bigint) from public, anon, authenticated;
revoke all on function public.track_update_invoice(bigint, text, text, text, text, text, text, text, bigint, bigint, jsonb) from public, anon;
revoke all on function public.track_add_invoice_line(bigint, text) from public, anon;
revoke all on function public.track_update_invoice_line(bigint, bigint, numeric, text, boolean) from public, anon;
revoke all on function public.track_delete_invoice_line(bigint) from public, anon;

grant execute on function public.track_update_invoice(bigint, text, text, text, text, text, text, text, bigint, bigint, jsonb) to authenticated;
grant execute on function public.track_add_invoice_line(bigint, text) to authenticated;
grant execute on function public.track_update_invoice_line(bigint, bigint, numeric, text, boolean) to authenticated;
grant execute on function public.track_delete_invoice_line(bigint) to authenticated;
