-- Track's estimate and invoice rows lead with a Description column
-- (Wized: Quote_list_item_description, project_Invoice_list_description).
-- Both tables carry that column; the views were not passing it through.
-- Recreated rather than replaced: a column added in the middle is a
-- reorder, which CREATE OR REPLACE VIEW will not do.

drop view if exists xano_mirror.project_quotes;
create view xano_mirror.project_quotes with (security_invoker = true) as
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
       (q.mcps_fee_gbp)::numeric / 100.0        as mcps_fee_gbp_amount,
       (q.sequel_licencing_fee)::numeric / 100.0 as sequel_licence_amount,
       (q.sequel_search_fee)::numeric / 100.0    as sequel_search_amount,
       (q.local_grand_total)::numeric / 100.0    as grand_total_amount,
       q.created_at
  from xano_mirror.quotes q
  left join xano_mirror.services sv on sv.id = q.service
  left join xano_mirror.clients  c  on c.id  = q.clients_id;

drop view if exists xano_mirror.project_invoices;
create view xano_mirror.project_invoices with (security_invoker = true) as
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
       i.total_to_invoice   as total_amount,
       i.gbp_total_amount   as total_gbp_amount,
       i.gross_spend        as gross_spend_amount,
       i.total_sequel_profit as sequel_profit_amount,
       i.po_number,
       i.aws_link,
       i.qbo_invoice_id,
       i.created_at
  from xano_mirror.invoices i
  left join xano_mirror.clients c on c.id = i.client_id
  left join xano_mirror."user" u on u.id = i.music_supervisor_id
  left join xano_mirror.currencies_bank_accounts cb on cb.id = i.currency_id;

grant select on xano_mirror.project_quotes, xano_mirror.project_invoices to authenticated;
