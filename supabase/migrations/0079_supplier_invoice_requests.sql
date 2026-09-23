-- 0079_supplier_invoice_requests
--
-- REQUEST INVOICE… on a bill's share menu (Andy, 23 Sep): emails the supplier
-- the bill's upload link, after a confirm that shows who it is going to. The
-- last request is recorded on the bill's row so the Bills list can say so.
alter table public.track_supplier_invoices
  add column if not exists requested_to  text,
  add column if not exists requested_at  timestamptz,
  add column if not exists requested_by  bigint,
  add column if not exists request_error text;
