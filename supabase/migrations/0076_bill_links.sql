-- 0076_bill_links
--
-- Which project a QuickBooks bill belongs to, where the bill cannot say so
-- itself. Almost every bill does: its memo carries the Sequel invoice number
-- (Andy, 23 Sep — 127 of 130 bills), and the quickbooks edge function reads
-- that live. This table is only for the exceptions: a memo with the wrong
-- number, a bill with no memo, a bill that belongs to no project.
--
-- App-owned, in public: NOT on invoice_line_items.qbo_bill_id, which the hourly
-- Xano sync overwrites.
--
-- Read and written by the quickbooks edge function with the service role only.

create table if not exists public.track_bill_links (
  bill_id     text primary key,              -- QuickBooks Bill.Id
  project_id  bigint,                         -- null with not_project = true
  not_project boolean not null default false, -- an overhead: belongs to no project
  note        text,
  created_by  bigint,
  created_at  timestamptz not null default now(),
  check (project_id is not null or not_project)
);

alter table public.track_bill_links enable row level security;
revoke all on public.track_bill_links from anon, authenticated;

comment on table public.track_bill_links is
  'Manual project for a QuickBooks bill whose memo does not name its invoice. Service role only.';
