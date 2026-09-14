-- Mirror insert trap 1 and 2, for the invoice tables.
--
-- ⚠️ A MIRRORED TABLE ARRIVES WITH NO `id` DEFAULT AND NO `uuid` DEFAULT,
-- because every row the sync writes carries Xano's own. The moment the new app
-- creates a row of its own, the insert fails on a not-null violation with
-- nothing else wrong. `supplier_list` hit it, `project_master_list` hit it,
-- `quotes` hit it — and each was fixed the same way, which is this.
--
-- It is written up as trap 1 of four in the handover and in §3a of the
-- migration note, and it was still walked into on 14 Sep. Reading the list is
-- not the same as applying it: check `column_default` on `id` and `uuid`
-- BEFORE writing the insert, not after the constraint fires.
--
-- ⚠️ THE SEQUENCES START WELL ABOVE XANO'S CURRENT MAX, deliberately. Both
-- stacks are issuing ids until cutover: Xano counts up from its own table
-- (invoices were at 293, lines at 287) and anything created here counts up from
-- the sequence. Starting at 1000 leaves 700 invoices of clear air between them
-- rather than a collision on the next Xano insert — the same gap `quotes` was
-- given, which is why a quote raised in the new app comes out at 1006.
create sequence if not exists xano_mirror.invoices_id_seq as bigint start with 1000 owned by xano_mirror.invoices.id;
create sequence if not exists xano_mirror.invoice_line_items_id_seq as bigint start with 1000 owned by xano_mirror.invoice_line_items.id;

-- Never move a sequence backwards; if Xano has already gone past 1000, follow it.
select setval('xano_mirror.invoices_id_seq',
              greatest(1000, coalesce((select max(id) from xano_mirror.invoices), 0) + 1), false);
select setval('xano_mirror.invoice_line_items_id_seq',
              greatest(1000, coalesce((select max(id) from xano_mirror.invoice_line_items), 0) + 1), false);

alter table xano_mirror.invoices
  alter column id set default nextval('xano_mirror.invoices_id_seq'),
  alter column uuid set default gen_random_uuid();

alter table xano_mirror.invoice_line_items
  alter column id set default nextval('xano_mirror.invoice_line_items_id_seq');
