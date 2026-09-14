-- Child lists for the project page. All security_invoker, so the RLS on the
-- underlying tables decides visibility rather than the view's owner.
--
-- MONEY. Xano stores quote amounts in minor units and invoice amounts in major
-- units. Verified: quote 391's local_grand_total is 1155000 and its line items
-- sum to exactly 1155000, i.e. GBP 11,550; invoice 1165's total_to_invoice of
-- 3355 is GBP 3,355. That difference is normalised here, once, so no page has
-- to remember it. Every *_amount column below is in major units.

create or replace view xano_mirror.project_quotes
with (security_invoker = true) as
select q.id,
       q.project_master_list_id,
       q.status,
       q.music_type,
       q.currency,
       sv.service,
       c.company                       as client,
       q.artist_name,
       q.song_name,
       q.territory,
       q.term,
       q.mcps_fee_gbp         / 100.0  as mcps_fee_gbp_amount,
       q.sequel_licencing_fee / 100.0  as sequel_licence_amount,
       q.sequel_search_fee    / 100.0  as sequel_search_amount,
       q.local_grand_total    / 100.0  as grand_total_amount,
       q.created_at
from xano_mirror.quotes q
left join xano_mirror.services sv on sv.id = q.service
left join xano_mirror.clients  c  on c.id = q.clients_id;

create or replace view xano_mirror.project_invoices
with (security_invoker = true) as
select i.id,
       i.project_master_list_id,
       i.invoice_number,
       i.status,
       i.invoice_date,
       i.due_date,
       cb.currency                     as currency,
       c.company                       as client,
       u.name                          as music_supervisor,
       i.song_name,
       i.artist_name,
       i.total_to_invoice              as total_amount,
       i.gbp_total_amount              as total_gbp_amount,
       i.gross_spend                   as gross_spend_amount,
       i.total_sequel_profit           as sequel_profit_amount,
       i.po_number,
       i.aws_link,
       i.qbo_invoice_id,
       i.created_at
from xano_mirror.invoices i
left join xano_mirror.clients c on c.id = i.client_id
left join xano_mirror."user" u on u.id = i.music_supervisor_id
left join xano_mirror.currencies_bank_accounts cb on cb.id = i.currency_id;

create or replace view xano_mirror.project_contracts
with (security_invoker = true) as
select ct.id,
       ct.project_master_list_id,
       ct.file_name,
       ct.description,
       t.type                          as contract_type,
       s.title                         as supplier,
       ct.artist,
       ct.song_name,
       ct.status,
       ct.confirmed,
       ct.start_date,
       ct.end_date,
       ct.perpetual,
       ct.master_pct,
       ct.publishing_pct,
       ct.url,
       ct.created_at
from xano_mirror.contracts ct
left join xano_mirror.contract_types t on t.id = ct.contract_type
left join xano_mirror.supplier_list  s on s.id = ct.supplier_list_id;

create or replace view xano_mirror.project_briefs
with (security_invoker = true) as
select b.id,
       b.project_master_list_id,
       b.name,
       b.brief_type,
       b.status,
       b.source,
       b.one_sentence_brief,
       b.vocal_or_instrumental,
       b.client_deadline,
       b.sequel_deadline,
       b.submitted_at,
       u.name                          as requested_by,
       b.created_at
from xano_mirror.briefs b
left join xano_mirror."user" u on u.id = b.requested_by;

create or replace view xano_mirror.project_files
with (security_invoker = true) as
select a.id,
       a.project_master_list_id,
       a.file_name,
       a.description,
       a.asset_tag,
       a.file_size,
       a.file_type,
       a.url,
       a.final_edit,
       u.name                          as uploaded_by,
       a.created_at
from xano_mirror.project_assets a
left join xano_mirror."user" u on u.id = a.uploaded_by;

revoke all on xano_mirror.project_quotes,    xano_mirror.project_invoices,
              xano_mirror.project_contracts, xano_mirror.project_briefs,
              xano_mirror.project_files from anon, public;
grant select on xano_mirror.project_quotes,    xano_mirror.project_invoices,
                xano_mirror.project_contracts, xano_mirror.project_briefs,
                xano_mirror.project_files to authenticated;
