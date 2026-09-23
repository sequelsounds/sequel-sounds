-- 0077_supplier_invoices
--
-- A supplier's own invoice for a QuickBooks bill, uploaded through a link
-- (Andy, 23 Sep): the supplier — or a member of staff — opens
-- /bill-upload/<token>, uploads the invoice, AI reads it, and if it matches the
-- bill it is attached to the bill in QuickBooks. If it does not match, finance
-- is told and decides.
--
-- One row per bill. The token is the only credential the supplier holds, so it
-- is long and random, and the row is never readable from the browser: RLS on,
-- no policies, every privilege revoked. The quickbooks edge function does all
-- of it with the service role.
--
-- ⚠️ THE BILL ITSELF IS NEVER EDITED. The only QuickBooks write is adding the
-- file as an Attachable on the bill.

create table if not exists public.track_supplier_invoices (
  bill_id           text primary key,                     -- QuickBooks Bill.Id
  token             text not null unique default encode(gen_random_bytes(24), 'hex'),
  -- What the bill says, snapshotted when the link is made, so the page does not
  -- have to go to QuickBooks for a supplier opening it.
  vendor_id         text,
  vendor_name       text,
  currency          text,
  total             numeric,
  project_id        bigint,
  project_sequel_no text,
  invoice_number    text,                                 -- our invoice the bill belongs to
  created_by        bigint,
  created_at        timestamptz not null default now(),
  -- waiting  → link made, nothing uploaded (or a rejected upload being replaced)
  -- review   → uploaded, the check found a difference: finance decides
  -- attached → in QuickBooks
  -- rejected → finance said no; the supplier can upload again
  -- failed   → the check or the attach broke; finance can retry
  status            text not null default 'waiting'
                    check (status in ('waiting', 'review', 'attached', 'rejected', 'failed')),
  file_key          text,                                 -- path in the supplier-invoices storage bucket
  file_name         text,
  file_type         text,
  file_size         integer,
  uploaded_at       timestamptz,
  uploaded_by       bigint,                               -- staff id when staff uploaded it
  uploader_note     text,
  ai_check          jsonb,                                -- what was read, and each comparison
  qbo_attachable_id text,
  decided_by        bigint,
  decided_at        timestamptz,
  error             text
);

alter table public.track_supplier_invoices enable row level security;
revoke all on public.track_supplier_invoices from anon, authenticated;

comment on table public.track_supplier_invoices is
  'Supplier invoice uploads against QuickBooks bills: link token, file, AI check, attach state. Service role only.';

-- The files themselves, in a private Supabase Storage bucket like the signed
-- Schedule As. Not S3: the signer's IAM policy is scoped per prefix and adding
-- one is Andy's to do; this needs no IAM change. 15 MB, PDF or image.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-invoices', 'supplier-invoices', false, 15728640,
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;
