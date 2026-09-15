-- 15 Sep 2026. Archiving an invoice from the project page's Invoicing list.
--
-- The old app's delete icon calls Xano's set_invoice_to_archive, which sets
-- status "Archived" and nothing else; get_project_invoices then leaves the row
-- out. Nothing is ever hard-deleted — Andy, 4 Sep.
--
-- ⚠️ ONE RULE THE OLD APP DOES NOT HAVE — Andy, 15 Sep: once an invoice is in
-- QuickBooks, only finance can archive it. Xano's endpoint lets any signed-in
-- user archive anything, raised or not. Raised means qbo_invoice_id is set,
-- the same single flag every other invoice write keys off.
create or replace function public.track_archive_invoice(p_invoice_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_inv xano_mirror.invoices;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can archive an invoice.' using errcode = '42501';
  end if;

  select * into v_inv from xano_mirror.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if coalesce(v_inv.qbo_invoice_id, '') <> '' and not public.track_is_finance() then
    raise exception 'This invoice is in QuickBooks. Only finance can archive it.'
      using errcode = '42501';
  end if;

  update xano_mirror.invoices i
     set status = 'Archived'
   where i.id = p_invoice_id;
end
$function$;

revoke all on function public.track_archive_invoice(bigint) from public, anon;
grant execute on function public.track_archive_invoice(bigint) to authenticated;
