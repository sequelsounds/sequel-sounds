-- 15 Sep 2026. The status dropdown on /invoice.
--
-- The old app's page has a Status select (invoice_status_select) writing
-- through update_invoice, with the seven values of the status enum, and it
-- only works until the invoice is in QuickBooks. That select is also how an
-- invoice is archived from its own page — there is no separate button.
--
-- ⚠️ Andy, 15 Sep: once an invoice is raised, only finance can change it. So
-- here staff can set any of the seven before the raise; after it, finance can
-- still set the status (archive it, or correct a wrong Paid or Overdue, which
-- the old app's own comment says finance needs) and nobody else can. Every
-- OTHER field on a raised invoice stays locked for everyone.
create or replace function public.track_set_invoice_status(p_invoice_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_inv xano_mirror.invoices;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can change an invoice.' using errcode = '42501';
  end if;

  if p_status is null or not (p_status = any (array[
    'Submitted', 'Returned', 'Awaiting Payment', 'Paid', 'Overdue', 'Failed', 'Archived'
  ])) then
    raise exception 'Unknown invoice status: %', coalesce(p_status, '(none)')
      using errcode = '23514';
  end if;

  select * into v_inv from xano_mirror.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if coalesce(v_inv.qbo_invoice_id, '') <> '' and not public.track_is_finance() then
    raise exception 'This invoice is in QuickBooks. Only finance can change it.'
      using errcode = '42501';
  end if;

  update xano_mirror.invoices i
     set status = p_status
   where i.id = p_invoice_id;
end
$function$;

revoke all on function public.track_set_invoice_status(bigint, text) from public, anon;
grant execute on function public.track_set_invoice_status(bigint, text) to authenticated;
