-- The project page's Estimates rows need two things they did not have:
--
--   * `uuid`, so a row can open the quote document. Same gap the invoice rows
--     had until 14 Sep — a list of quotes with nowhere to click.
--   * `currency_code`, because the SYMBOL is "$" for both USD and SGD, so a
--     Sequel user scanning the list cannot tell a US quote from a Singapore
--     one. The document itself was fixed in August; this list was missed.
--
-- ⚠️ Both are APPENDED. `create or replace view` cannot reorder or rename an
-- existing column, only add to the end.
create or replace view xano_mirror.project_quotes with (security_invoker = true) as
 SELECT q.id,
    q.project_master_list_id,
    q.description,
    q.status,
    q.music_type,
    q.currency,
    sv.service,
    c.company AS client,
    q.artist_name,
    q.song_name,
    q.territory,
    q.term,
    q.mcps_fee_gbp::numeric / 100.0 AS mcps_fee_gbp_amount,
    q.sequel_licencing_fee::numeric / 100.0 AS sequel_licence_amount,
    q.sequel_search_fee::numeric / 100.0 AS sequel_search_amount,
    q.local_grand_total::numeric / 100.0 AS grand_total_amount,
    q.created_at,
    qcb.symbol AS currency_symbol,
    q.uuid,
    qcb.currency AS currency_code
   FROM xano_mirror.quotes q
     LEFT JOIN xano_mirror.services sv ON sv.id = q.service
     LEFT JOIN xano_mirror.clients c ON c.id = q.clients_id
     LEFT JOIN xano_mirror.currencies_bank_accounts qcb ON qcb.id = q.quote_currency;

grant select on xano_mirror.project_quotes to authenticated;

