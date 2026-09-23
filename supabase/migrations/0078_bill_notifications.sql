-- 0078_bill_notifications
--
-- Notifications along the supplier bill's way (Andy, 23 Sep). With 0075 and the
-- quickbooks edge function, the full set is:
--
--   supplier uploads an invoice     → finance: "ready to approve" or "needs a look"   (edge function)
--   finance approves / rejects      → supervisor                                       (edge function)
--   our invoice is paid             → finance: each approved bill on it is ready to pay (here)
--   our invoice is paid, MCPS lines → supervisor + finance: take out the MCPS licence   (here)
--
-- Only invoices_notify changes. "Ready to pay" can only name bills whose
-- supplier invoice came through the app; the rest are still on the Bills tab.

create or replace function xano_mirror.invoices_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_project text := coalesce(public.track_project_label(new.project_master_list_id), 'a project');
  v_super   bigint := coalesce(nullif(new.music_supervisor_id, 0)::bigint,
                               public.track_project_supervisor(new.project_master_list_id));
  v_what    text := case when nullif(trim(new.invoice_number), '') is not null
                         then 'Invoice ' || trim(new.invoice_number) else 'The invoice' end;
  v_amount  text;
  v_link    text := '/invoices/' || new.uuid;
  v_fin     bigint;
  v_bill    record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'INSERT' and new.created_at < now() - interval '2 days' then
    return new;
  end if;

  if new.status = 'Submitted' then
    select left(c.currency, 3) || ' ' || to_char(new.total_to_invoice, 'FM999,999,990.00')
      into v_amount
      from xano_mirror.currencies_bank_accounts c where c.id = new.currency_id;
    for v_fin in select id from public.track_users where is_finance loop
      perform public.track_notify(v_fin, 'invoice_submitted',
        'Invoice request for ' || v_project
          || coalesce(' (' || v_amount || ')', '') || ' is ready to raise.',
        new.project_master_list_id, 'invoice', new.uuid, v_link);
    end loop;
  elsif new.status = 'Awaiting Payment' then
    perform public.track_notify(v_super, 'invoice_raised',
      v_what || ' for ' || v_project || ' has been raised.',
      new.project_master_list_id, 'invoice', new.uuid, v_link);
  elsif new.status = 'Paid' then
    perform public.track_notify(v_super, 'invoice_paid',
      v_what || ' for ' || v_project || ' has been paid.',
      new.project_master_list_id, 'invoice', new.uuid, v_link);

    -- Supplier bills on this invoice whose invoice is already approved into
    -- QuickBooks are now ready to pay: tell finance, one per bill.
    for v_bill in
      select s.bill_id, s.vendor_name, s.currency, s.total, s.token
        from public.track_supplier_invoices s
       where s.invoice_number = new.invoice_number
         and s.status = 'attached'
    loop
      for v_fin in select id from public.track_users where is_finance loop
        perform public.track_notify(v_fin, 'bill_ready_to_pay',
          'Ready to pay: ' || trim(regexp_replace(coalesce(v_bill.vendor_name, 'a supplier'), '\s*(GBP|USD|EUR|EURO|SGD|JPY|YEN)?\s*[$£€¥]?\s*$', '', 'i'))
            || ' ' || coalesce(v_bill.currency || ' ', '') || to_char(v_bill.total, 'FM999,999,990.00')
            || ' for ' || v_project || '. The client has paid.',
          new.project_master_list_id, 'bill', md5('ready:' || v_bill.bill_id)::uuid,
          '/projects/' || new.project_master_list_id || '?tab=Bills');
      end loop;
    end loop;

    -- ⚠️ MCPS WAITS FOR THIS (Andy, 23 Sep): Sequel only takes out an MCPS
    -- licence once the client has paid. Any paythrough line with a supplier
    -- that bills through MCPS's QuickBooks vendor means a licence is now due.
    if exists (
      select 1
        from xano_mirror.invoice_line_items l
        join xano_mirror.supplier_list sl on sl.id = l.supplier_id
       where l.invoice_id = new.id
         and l.is_paythrough
         and sl.qbo_vendor_id = (select m.qbo_vendor_id from xano_mirror.supplier_list m
                                  where m.title ilike 'mcps' and m.qbo_vendor_id is not null limit 1)
    ) then
      perform public.track_notify(v_super, 'mcps_licence_due',
        'The client has paid ' || lower(v_what) || ' for ' || v_project || '. Take out the MCPS licence.',
        new.project_master_list_id, 'invoice', new.uuid, v_link);
      for v_fin in select id from public.track_users where is_finance loop
        perform public.track_notify(v_fin, 'mcps_licence_due',
          'The client has paid ' || lower(v_what) || ' for ' || v_project || '. Take out the MCPS licence.',
          new.project_master_list_id, 'invoice', new.uuid, v_link);
      end loop;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'invoice % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.invoices_notify() from public, anon, authenticated;
