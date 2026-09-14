-- Applied to the remote as 20260914..._track_create_invoice_request, then
-- patched in place to resolve the supervisor through public.track_users.
--
-- ⚠️ Kept here as well as in the database. 89 migrations exist only in the
-- remote history with no backup; adding a 90th was not worth it when writing
-- the file costs nothing.
--
-- The invoice request form's one write path, faithful to Xano api 516: header
-- and line items in a single call, and the three totals DERIVED HERE rather
-- than accepted from the browser.
--
-- ⚠️ THE THREE TOTALS ARE NOT INTERCHANGEABLE (invoicing doc §2.2):
--
--   total to invoice = all Sequel fees + PAYTHROUGH third-party rows only
--   total spend      = all Sequel fees + EVERY third-party row
--   profit           = all Sequel fees, no third-party rows
--
-- Every Sequel fee is in all three; there are no exceptions left. Studio fees
-- were the last one and stopped being special on 29 Aug 2026, because "total
-- spend" means what the CLIENT spent on music, not what left Sequel's bank.
-- Spend equalling the invoice total is therefore CORRECT whenever every row is
-- a paythrough, not a fault.
--
-- Four separate bugs on the old form came from a screen and a stored value each
-- implementing the same sum slightly differently. There is one implementation.
--
-- ⚠️ COST AVOIDANCE IS STORED AND MUST NEVER REACH A TOTAL. It is what the
-- client was SAVED against the original quote — money that did not move. Adding
-- it to spend would inflate 2026 by roughly 1.57m across currencies. That it is
-- absent from the arithmetic below is the safety property; do not "fix" it.
--
-- ⚠️ Fees are written as COLUMNS, not as line rows. Model B is half done on
-- purpose and the invoicing doc's §2.5.5 recommendation is to leave the split
-- alone. Writing fee rows here would put an invoice's fees in two shapes at
-- once and the totals would count them twice.
create or replace function public.track_create_invoice_request(
  p_project_id        bigint,
  p_client_id         bigint,
  p_currency_id       bigint,
  p_description       text,
  p_po_number         text    default null,
  p_po_attachment_url text    default null,
  p_song_name         text    default null,
  p_artist_name       text    default null,
  p_usage_territories text    default null,
  p_usage_region      text    default null,
  p_fees              jsonb   default '{}'::jsonb,
  p_lines             jsonb   default '[]'::jsonb
)
returns table(id bigint, uuid uuid)
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_invoice_id bigint;
  v_uuid       uuid;
  v_line       jsonb;
  v_amount     numeric;
  v_paythrough boolean;
  v_supplier   int;
  v_category   text;

  v_fees    numeric := 0;   -- every Sequel fee
  v_paythru numeric := 0;   -- third-party rows the client settles through Sequel
  v_third   numeric := 0;   -- every third-party row

  v_key  text;
  v_cols text[] := array[
    'demo_contingency_fee', 'sequel_demo_fee',
    'search_contingency_fee', 'sequel_search_fee',
    'master_sequel_studios_fee', 'master_sequel_licence_fee',
    'publishing_sequel_studios_fee', 'publishing_sequel_licence_fee',
    'sequel_consultancy_fee'
  ];
  v_allowed_regions text[] := array[
    'Africa', 'Asia', 'Europe', 'Global', 'Latin America',
    'NAMET & RUB', 'North America', 'North Asia', 'SEAA', 'South Asia'
  ];
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can raise an invoice request.' using errcode = '42501';
  end if;

  if p_project_id is null or p_client_id is null or p_currency_id is null
     or coalesce(btrim(p_description), '') = '' then
    raise exception 'An invoice needs a project, a client to bill, a currency and a description.'
      using errcode = '23514';
  end if;

  -- ⚠️ usage_region is an ENUM in Xano and an unknown value is rejected there,
  -- taking the whole submit with it rather than just the field.
  if p_usage_region is not null and btrim(p_usage_region) <> ''
     and not (p_usage_region = any(v_allowed_regions)) then
    raise exception 'Unknown usage region: %', p_usage_region using errcode = '23514';
  end if;

  foreach v_key in array v_cols loop
    v_fees := v_fees + round(coalesce((p_fees ->> v_key)::numeric, 0), 2);
  end loop;

  insert into xano_mirror.invoices (
    created_at, status, description,
    project_master_list_id, client_id, currency_id,
    po_number, po_attachment_url,
    song_name, artist_name, usage_territories, usage_region,
    demo_contingency_fee, sequel_demo_fee,
    search_contingency_fee, sequel_search_fee,
    master_sequel_studios_fee, master_sequel_licence_fee,
    publishing_sequel_studios_fee, publishing_sequel_licence_fee,
    sequel_consultancy_fee,
    demo_cost_avoidance, search_cost_avoidance, master_cost_avoidance,
    publishing_cost_avoidance, other_cost_avoidance,
    music_supervisor_id,
    total_to_invoice, gross_spend, total_sequel_profit
  ) values (
    now(), 'Submitted', btrim(p_description),
    nullif(p_project_id, 0), nullif(p_client_id, 0), nullif(p_currency_id, 0),
    nullif(btrim(coalesce(p_po_number, '')), ''), p_po_attachment_url,
    p_song_name, p_artist_name, p_usage_territories,
    nullif(btrim(coalesce(p_usage_region, '')), ''),
    round(coalesce((p_fees ->> 'demo_contingency_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'sequel_demo_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'search_contingency_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'sequel_search_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'master_sequel_studios_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'master_sequel_licence_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'publishing_sequel_studios_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'publishing_sequel_licence_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'sequel_consultancy_fee')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'demo_cost_avoidance')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'search_cost_avoidance')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'master_cost_avoidance')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'publishing_cost_avoidance')::numeric, 0), 2),
    round(coalesce((p_fees ->> 'other_cost_avoidance')::numeric, 0), 2),
    -- ⚠️ Stamped from the session, never accepted as an input — the same rule
    -- as Music_Supervisor on project create. It records who RAISED the invoice.
    -- track_users.id IS the Xano user id; they are the same numbers.
    coalesce((select tu.id from public.track_users tu where tu.auth_user_id = auth.uid() limit 1), 0),
    0, 0, 0
  )
  returning xano_mirror.invoices.id, xano_mirror.invoices.uuid into v_invoice_id, v_uuid;

  -- The supplier lines. Every one is third_party: a Sequel fee is a column on
  -- this path, never a row.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_amount   := round(coalesce((v_line ->> 'amount')::numeric, 0), 2);
    v_supplier := coalesce((v_line ->> 'supplier_id')::int, 0);
    v_category := coalesce(v_line ->> 'category', '');
    -- ⚠️ Paythrough decides whether the client is BILLED for this cost. The
    -- string "false" is truthy in the old stack, and billing something that
    -- must not be billed is the expensive direction.
    v_paythrough := coalesce((v_line ->> 'is_paythrough')::boolean, false);

    -- A line with no supplier and no money is an empty row someone tabbed past.
    if v_supplier = 0 and v_amount = 0 then
      continue;
    end if;

    insert into xano_mirror.invoice_line_items
      (invoice_id, supplier_id, category, line_type, fee_type,
       currency, fee_amount, is_paythrough, created_at)
    values
      (v_invoice_id, nullif(v_supplier, 0), v_category, 'third_party', null,
       nullif(p_currency_id, 0), v_amount, v_paythrough, now());

    v_third := v_third + v_amount;
    if v_paythrough then
      v_paythru := v_paythru + v_amount;
    end if;
  end loop;

  update xano_mirror.invoices i
     set total_to_invoice    = v_fees + v_paythru,
         gross_spend         = v_fees + v_third,
         total_sequel_profit = v_fees
   where i.id = v_invoice_id;

  return query select v_invoice_id, v_uuid;
end
$function$;

revoke all on function public.track_create_invoice_request(
  bigint, bigint, bigint, text, text, text, text, text, text, text, jsonb, jsonb
) from public, anon;

grant execute on function public.track_create_invoice_request(
  bigint, bigint, bigint, text, text, text, text, text, text, text, jsonb, jsonb
) to authenticated;
