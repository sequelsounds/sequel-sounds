-- Creating a quote — the six non-MCPS paths of the old app's wizard.
--
-- ⚠️ `quotes` and `quote_line_items` are still in the hourly sync, and they are
-- on the BLOCKED side of it (QuickBooks, BoldSign and Coda read Xano), so a
-- quote created here is DELETED on the hour. That is expected: Andy's call
-- (known-issues §1.5) is that the rebuild is built and tested against the
-- mirror with throwaway data and cut over once, at the end.
--
-- The four traps every mirror table hits on its first insert, all present here:
--   1. `id` had no default — the rows arrived carrying Xano's own ids
--   2. `uuid` had no default — the fault that made a supplier unreachable
--   3. integer FKs defaulted to `0`, Xano's "unset", against real foreign keys
--   4. (no `<>` list filter on this table, so the fourth does not apply)

-- 1 + 3. Sequences well clear of the highest id Xano ever issued (391 and 199),
-- so which side of the cutover a row was created is obvious from its id.
create sequence if not exists xano_mirror.quotes_id_seq start with 1000 owned by xano_mirror.quotes.id;
create sequence if not exists xano_mirror.quote_line_items_id_seq start with 1000 owned by xano_mirror.quote_line_items.id;

alter table xano_mirror.quotes           alter column id set default nextval('xano_mirror.quotes_id_seq');
alter table xano_mirror.quote_line_items alter column id set default nextval('xano_mirror.quote_line_items_id_seq');

-- 2. A quote with no uuid cannot be opened by any route in either app.
alter table xano_mirror.quotes alter column uuid set default gen_random_uuid();
update xano_mirror.quotes set uuid = gen_random_uuid() where uuid is null;

-- 3. Xano's unset integer FK is 0; Postgres' is null, and no lookup row is 0.
alter table xano_mirror.quotes
  alter column quote_currency drop default,
  alter column project_master_list_id drop default,
  alter column service drop default,
  alter column clients_id drop default;

alter table xano_mirror.quote_line_items
  alter column quote_id drop default,
  alter column currencies_bank_accounts_id drop default,
  alter column services_id drop default;

-- The whole write surface, in one place.
--
-- ⚠️ SECURITY DEFINER, and `authenticated` is deliberately given NO insert
-- grant on either table. A quote is seven categories of money written across
-- two tables and then summed; letting a form assemble that row by row is how
-- the totals on the old app's create form drifted from the stored value four
-- separate times. One function, one implementation of the sum.
--
-- Faithful to Xano's `quotes` (api 420):
--   * Status "Draft", grand total patched at the end
--   * six categories multiply by the track count, SEARCHES DO NOT — a search
--     fee is charged per search, and its own quantity carries that count
--   * null or 0 tracks both mean charge ONCE, not charge nothing
--   * costs are multiplied by 100 on the way in
--   * a supplier line is written when cost > 0 OR its description is non-empty
--   * `media` is a list column and the terms screen collects prose, so a
--     non-empty value goes in as a single-item array
create or replace function public.track_create_quote(
  p_project_id    bigint,
  p_client_id     bigint,
  p_currency_id   bigint,
  p_service_id    bigint,
  p_description   text,
  p_term          text default null,
  p_territory     text default null,
  p_media         text default null,
  p_scripts       text default null,
  p_duration      text default null,
  p_cutdowns      boolean default null,
  p_song_name     text default null,
  p_artist_name   text default null,
  p_tracks_quoted int default null,
  p_fees          jsonb default '{}'::jsonb
)
returns table (id bigint, uuid uuid)
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $$
declare
  v_quote_id   bigint;
  v_uuid       uuid;
  v_multiplier int;
  v_cat        record;
  v_cat_mult   int;
  v_cat_data   jsonb;
  v_fee        numeric;
  v_cost       numeric;
  v_qty        int;
  v_line       jsonb;
  v_desc       text;
  v_total      numeric := 0;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can raise a quote.' using errcode = '42501';
  end if;

  if p_project_id is null or p_client_id is null
     or p_currency_id is null or p_service_id is null
     or coalesce(btrim(p_description), '') = '' then
    raise exception 'A quote needs a project, a client, a currency, a type and a description.'
      using errcode = '23514';
  end if;

  -- null (never asked) and 0 (covers no tracks) both charge the fees once.
  v_multiplier := case when coalesce(p_tracks_quoted, 0) > 0 then p_tracks_quoted else 1 end;

  insert into xano_mirror.quotes (
    created_at, status, description,
    project_master_list_id, clients_id, quote_currency, service,
    term, territory, media, scripts, duration, cutdowns_includedyn,
    song_name, artist_name, tracks_quoted, local_grand_total
  ) values (
    now(), 'Draft', btrim(p_description),
    nullif(p_project_id, 0), nullif(p_client_id, 0),
    nullif(p_currency_id, 0), nullif(p_service_id, 0),
    p_term, p_territory,
    case when coalesce(btrim(p_media), '') = '' then null else array[btrim(p_media)] end,
    p_scripts, p_duration, p_cutdowns,
    p_song_name, p_artist_name, p_tracks_quoted, 0
  )
  returning xano_mirror.quotes.id, xano_mirror.quotes.uuid into v_quote_id, v_uuid;

  for v_cat in
    select * from (values
      ('searches',       'Search',         'sequel_search_cost',         'Sequel Search Fee',         false),
      ('production',     'Production',     'sequel_production_cost',     'Sequel Production Fee',     true),
      ('master',         'Master',         'sequel_master_cost',         'Sequel Master Fee',         true),
      ('publishing',     'Publishing',     'sequel_publishing_cost',     'Sequel Publishing Fee',     true),
      ('sonic_branding', 'Sonic Branding', 'sequel_sonic_branding_cost', 'Sequel Sonic Branding Fee', true),
      ('talent',         'Talent',         'sequel_talent_cost',         'Sequel Talent Fee',         true),
      ('other',          'Other',          'sequel_other_cost',          'Sequel Other Fee',          true)
    ) as c(key, name, fee_key, fee_desc, multiply)
  loop
    v_cat_data := p_fees -> v_cat.key;
    if v_cat_data is null or jsonb_typeof(v_cat_data) <> 'object' then
      continue;
    end if;

    v_cat_mult := case when v_cat.multiply then v_multiplier else 1 end;

    -- The single Sequel fee for the category.
    v_fee := round(coalesce((v_cat_data ->> v_cat.fee_key)::numeric, 0) * 100) * v_cat_mult;
    if v_fee > 0 then
      v_qty := v_cat_mult;
      if v_cat.key = 'searches' then
        v_qty := coalesce((v_cat_data ->> 'sequel_search_quantity')::int, 1);
      end if;

      insert into xano_mirror.quote_line_items
        (quote_id, category, fee_description, cost, quantity,
         currencies_bank_accounts_id, services_id, fee_type)
      values
        (v_quote_id, v_cat.name, v_cat.fee_desc, v_fee, v_qty,
         nullif(p_currency_id, 0), nullif(p_service_id, 0), 'sequel_fee');

      v_total := v_total + v_fee;
    end if;

    -- The supplier lines.
    for v_line in select * from jsonb_array_elements(coalesce(v_cat_data -> 'lines', '[]'::jsonb))
    loop
      v_cost := round(coalesce((v_line ->> 'cost')::numeric, 0) * 100) * v_cat_mult;
      v_desc := coalesce(btrim(v_line ->> 'description'), '');

      if v_cost > 0 or v_desc <> '' then
        insert into xano_mirror.quote_line_items
          (quote_id, category, fee_description, cost, quantity,
           currencies_bank_accounts_id, services_id, fee_type)
        values
          (v_quote_id, v_cat.name, v_desc, v_cost, v_cat_mult,
           nullif(p_currency_id, 0), nullif(p_service_id, 0), 'supplier_cost');

        v_total := v_total + v_cost;
      end if;
    end loop;
  end loop;

  update xano_mirror.quotes q set local_grand_total = v_total where q.id = v_quote_id;

  return query select v_quote_id, v_uuid;
end
$$;

revoke all on function public.track_create_quote(
  bigint, bigint, bigint, bigint, text, text, text, text, text, text,
  boolean, text, text, int, jsonb) from public, anon;

grant execute on function public.track_create_quote(
  bigint, bigint, bigint, bigint, text, text, text, text, text, text,
  boolean, text, text, int, jsonb) to authenticated;

