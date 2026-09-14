-- Both row types show a currency SYMBOL in a fixed 0.7rem column, so the
-- amounts line up down the list: project_quote_currency_symbol returns
-- `.symbol` and project_Invoice_list_row_currency returns `.currency_symbol`.
--
-- The views were handing over a name instead. On invoices that is
-- currencies_bank_accounts.currency — "EURO", which rendered as a clipped
-- "EU". On quotes it is the quotes table's own free-text Currency column,
-- which holds "SGD $" on one row and "SGD" on the next. Both are resolved
-- through the FK to currencies_bank_accounts.symbol instead, which is a
-- single character per currency and the same one every time.
--
-- The old columns stay: the quote's own text is what was typed at the time,
-- and dropping it would lose that.

create or replace view xano_mirror.project_quotes with (security_invoker = true) as
select q.id,
       q.project_master_list_id,
       q.description,
       q.status,
       q.music_type,
       q.currency,
       sv.service,
       c.company as client,
       q.artist_name,
       q.song_name,
       q.territory,
       q.term,
       (q.mcps_fee_gbp)::numeric / 100.0         as mcps_fee_gbp_amount,
       (q.sequel_licencing_fee)::numeric / 100.0 as sequel_licence_amount,
       (q.sequel_search_fee)::numeric / 100.0    as sequel_search_amount,
       (q.local_grand_total)::numeric / 100.0    as grand_total_amount,
       q.created_at,
       qcb.symbol as currency_symbol
  from xano_mirror.quotes q
  left join xano_mirror.services sv on sv.id = q.service
  left join xano_mirror.clients  c  on c.id  = q.clients_id
  left join xano_mirror.currencies_bank_accounts qcb on qcb.id = q.quote_currency;

create or replace view xano_mirror.project_invoices with (security_invoker = true) as
select i.id,
       i.project_master_list_id,
       i.description,
       i.invoice_number,
       i.status,
       i.invoice_date,
       i.due_date,
       cb.currency,
       c.company as client,
       u.name    as music_supervisor,
       i.song_name,
       i.artist_name,
       i.total_to_invoice    as total_amount,
       i.gbp_total_amount    as total_gbp_amount,
       i.gross_spend         as gross_spend_amount,
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
