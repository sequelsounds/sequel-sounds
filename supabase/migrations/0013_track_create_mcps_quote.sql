-- Applied to the remote as 20260914215052_track_create_mcps_quote.
--
-- ⚠️ Kept here as well as in the database, unlike the 76 migrations that exist
-- ONLY in the database and have no backup (known-issues §5). One more orphan
-- was not worth adding while writing the file cost nothing.
--
-- The MCPS library estimate's one write path, a sibling to track_create_quote.
--
-- Faithful to Xano api 418's db.add: Status "Submitted" (not "Draft"), service
-- 3, Music_Type "Library", and at most three line items instead of seven fee
-- categories. Nobody types an amount anywhere on this path — the engine works
-- the price out from the rate card — so every figure arrives already computed
-- and in MINOR UNITS.
--
-- The client's Region is resolved HERE rather than trusted from the caller, so
-- the row records the region the uplift was actually charged against.
create or replace function public.track_create_mcps_quote(
  p_project_id            bigint,
  p_client_id             bigint,
  p_currency_id           bigint,
  p_description           text,
  p_song_name             text    default null,
  p_artist_name           text    default null,
  p_tracks_quoted         integer default null,
  p_term                  text    default null,
  p_territory             text    default null,
  p_mcps_territories      text    default null,
  p_scripts               text    default null,
  p_duration              text    default null,
  p_cutdowns              boolean default null,
  p_note                  text    default null,
  p_track_rate            text    default null,
  p_media                 text[]  default null,
  p_media_mcps            text[]  default null,
  p_online_worldwide      boolean default null,
  p_region                text    default null,
  p_mcps_fee_gbp          numeric default 0,
  p_mcps_local_fee        numeric default 0,
  p_sequel_licensing_fee  numeric default 0,
  p_search_fee            numeric default 0,
  p_searches_requested    integer default 0,
  p_grand_total           numeric default 0
)
returns table(id bigint, uuid uuid)
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_quote_id   bigint;
  v_uuid       uuid;
  v_multiplier int;
  v_region     text;
  v_currency   text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can raise an estimate.' using errcode = '42501';
  end if;

  if p_project_id is null or p_client_id is null
     or p_currency_id is null
     or coalesce(btrim(p_description), '') = '' then
    raise exception 'An estimate needs a project, a client, a currency and a description.'
      using errcode = '23514';
  end if;

  -- null (never asked) and 0 (covers no tracks) both charge once, not nothing.
  v_multiplier := case when coalesce(p_tracks_quoted, 0) > 0 then p_tracks_quoted else 1 end;

  -- ⚠️ The CLIENT'S region, not the licence territory. A North American client
  -- licensing Spain and France is charged the North American uplift and the
  -- North American search fee. Correct by design, and it reads oddly.
  select r.region into v_region
  from xano_mirror.clients c
  join xano_mirror.regions r on r.id = c.region
  where c.id = p_client_id;
  v_region := coalesce(v_region, p_region);

  select c.currency into v_currency
  from xano_mirror.currencies_bank_accounts c
  where c.id = p_currency_id;

  insert into xano_mirror.quotes (
    created_at, music_type, status, description,
    project_master_list_id, clients_id, quote_currency, service,
    artist_name, song_name, tracks_quoted,
    term, territory, mcps_territories, media, media_mcps, online_worldwide,
    scripts, duration, cutdowns_includedyn, mcps_track_rate, note,
    region, currency,
    mcps_fee_gbp, mcps_local_licence_fee, sequel_licencing_fee,
    sequel_search_fee, searches_requested, sequel_search_quantity,
    total_rights_fee, local_grand_total
  ) values (
    now(), 'Library', 'Submitted', btrim(p_description),
    nullif(p_project_id, 0), nullif(p_client_id, 0), nullif(p_currency_id, 0), 3,
    p_artist_name, p_song_name, p_tracks_quoted,
    p_term, p_territory, p_mcps_territories,
    coalesce(p_media, '{}'), coalesce(p_media_mcps, '{}'), p_online_worldwide,
    p_scripts, p_duration, p_cutdowns, p_track_rate, p_note,
    v_region, v_currency,
    round(p_mcps_fee_gbp), round(p_mcps_local_fee), round(p_sequel_licensing_fee),
    round(p_search_fee), p_searches_requested, p_searches_requested,
    null, round(p_grand_total)
  )
  returning xano_mirror.quotes.id, xano_mirror.quotes.uuid into v_quote_id, v_uuid;

  -- THREE LINE ITEMS, each guarded so no zero-value row is written.
  --
  -- ⚠️ The category on the two licence lines is "Master", not "Licensing" —
  -- the quotation page maps category to section through Fee_Categories and
  -- shows Master under Licensing. Changing it here moves them off the page.
  --
  -- quantity carries the track count on the two per-track lines so the document
  -- can show "2 ×" rather than an unexplained doubled figure.
  if round(p_search_fee) > 0 then
    insert into xano_mirror.quote_line_items
      (quote_id, category, fee_description, cost, quantity,
       currencies_bank_accounts_id, services_id, fee_type)
    values
      (v_quote_id, 'Search', 'Library search fee', round(p_search_fee),
       greatest(coalesce(p_searches_requested, 0), 1),
       nullif(p_currency_id, 0), 3, 'sequel_fee');
  end if;

  if round(p_mcps_local_fee) > 0 then
    insert into xano_mirror.quote_line_items
      (quote_id, category, fee_description, cost, quantity,
       currencies_bank_accounts_id, services_id, fee_type)
    values
      (v_quote_id, 'Master', 'MCPS licence fee', round(p_mcps_local_fee), v_multiplier,
       nullif(p_currency_id, 0), 3, 'supplier_cost');
  end if;

  if round(p_sequel_licensing_fee) > 0 then
    insert into xano_mirror.quote_line_items
      (quote_id, category, fee_description, cost, quantity,
       currencies_bank_accounts_id, services_id, fee_type)
    values
      (v_quote_id, 'Master', 'Sequel licensing fee', round(p_sequel_licensing_fee), v_multiplier,
       nullif(p_currency_id, 0), 3, 'sequel_fee');
  end if;

  return query select v_quote_id, v_uuid;
end
$function$;

revoke all on function public.track_create_mcps_quote(
  bigint, bigint, bigint, text, text, text, integer, text, text, text, text, text,
  boolean, text, text, text[], text[], boolean, text, numeric, numeric, numeric,
  numeric, integer, numeric
) from public, anon;

grant execute on function public.track_create_mcps_quote(
  bigint, bigint, bigint, text, text, text, integer, text, text, text, text, text,
  boolean, text, text, text[], text[], boolean, text, numeric, numeric, numeric,
  numeric, integer, numeric
) to authenticated;
