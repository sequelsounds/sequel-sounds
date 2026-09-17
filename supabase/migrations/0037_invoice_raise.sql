-- Raising an invoice into QuickBooks from the new app — 17 Sep 2026.
--
-- A port of Xano's check_invoice_ready (api 574), raise_invoice (575),
-- create_qbo_bill (fn 79), get_qbo_exchange_rates (fn 80) and
-- attach_file_to_qbo (fn 61). The QuickBooks calls live in the `quickbooks`
-- edge function; this file holds the data side.
--
-- Andy, 17 Sep: build it against Intuit's SANDBOX company and keep live
-- raising in the old app until the switch-over. `invoices` is still synced
-- from Xano, so a live raise recorded here would be overwritten on the hour
-- and the old app could raise the same job again.
--
-- What is here:
--   1. app_created on invoices and their lines, so test invoices made in the
--      new app survive the hourly sync (same trigger as briefs, 0035)
--   2. the connection tables learn a second environment, 'sandbox'
--   3. qbo_env_config — the per-company ids (item, tax codes, terms, account,
--      custom fields, staff numbers). Production's are Xano's, read 17 Sep.
--   4. qbo_id_map — a SANDBOX stand-in for clients.qbo_customer_id and
--      supplier_list.qbo_vendor_id, which hold PRODUCTION ids
--   5. qbo_raise_attempts — rule 1 of the raise: the attempt is written down
--      BEFORE the create, so a crash after it still points at QuickBooks
--   6. qbo_raise_check / qbo_raise_context / qbo_record_raise / qbo_mark_bill
--
-- ⚠️ The check and the raise share ONE check function. Xano deliberately
-- duplicated them (574 / 575) and they drifted twice. Here the raise calls the
-- same function server-side, so it still never trusts the browser, and there
-- is nothing to keep in step. The one Xano divergence kept: the exchange-rate
-- test needs a QuickBooks token, so the raise makes it and the check does not.

-- ── 1. app_created ──────────────────────────────────────────────────────────
alter table xano_mirror.invoices           add column if not exists app_created boolean not null default false;
alter table xano_mirror.invoice_line_items add column if not exists app_created boolean not null default false;

drop trigger if exists invoices_mark_app_created on xano_mirror.invoices;
create trigger invoices_mark_app_created
  before insert on xano_mirror.invoices
  for each row execute function xano_mirror.mark_app_created();

drop trigger if exists invoice_line_items_mark_app_created on xano_mirror.invoice_line_items;
create trigger invoice_line_items_mark_app_created
  before insert on xano_mirror.invoice_line_items
  for each row execute function xano_mirror.mark_app_created();

-- ── 2. two environments ─────────────────────────────────────────────────────
alter table public.qbo_connection drop constraint if exists qbo_connection_environment_check;
alter table public.qbo_connection add constraint qbo_connection_environment_check
  check (environment in ('production', 'sandbox'));

alter table public.qbo_oauth_state add column if not exists environment text not null default 'production'
  check (environment in ('production', 'sandbox'));

drop function if exists public.qbo_claim_refresh(uuid, int);
create or replace function public.qbo_claim_refresh(p_lock uuid, p_seconds int default 30, p_environment text default 'production')
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.qbo_connection;
begin
  select * into r from public.qbo_connection
   where environment = p_environment
   for update;

  if not found or r.refresh_token is null then
    return 'none';
  end if;

  if r.access_token is not null
     and r.access_expires_at > now() + interval '2 minutes' then
    return 'fresh';
  end if;

  if r.refresh_lock_until is not null and r.refresh_lock_until > now() then
    return 'busy';
  end if;

  update public.qbo_connection
     set refresh_lock_id = p_lock,
         refresh_lock_until = now() + make_interval(secs => p_seconds)
   where environment = p_environment;
  return 'claimed';
end
$$;
revoke all on function public.qbo_claim_refresh(uuid, int, text) from public, anon, authenticated;
grant execute on function public.qbo_claim_refresh(uuid, int, text) to service_role;

-- ── 3. per-company ids ──────────────────────────────────────────────────────
create table if not exists public.qbo_env_config (
  environment text primary key check (environment in ('production', 'sandbox')),
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.qbo_env_config enable row level security;
revoke all on public.qbo_env_config from anon, authenticated;

-- Production: every value is Xano's own (raise_invoice and create_qbo_bill,
-- read 17 Sep 2026). ⚠️ The staff numbers are the ORDER the names sit in the
-- QuickBooks "Staff Member" field and do not match the user ids.
insert into public.qbo_env_config (environment, config) values ('production', jsonb_build_object(
  'app_url',          'https://app.qbo.intuit.com',
  'invoice_item',     '9',
  'invoice_term',     '3',
  'tax_uk',           '6',
  'tax_other',        '10',
  'uk_country_id',    185,
  'bill_term',        '1000000001',
  'bill_account',     '15',
  'bill_tax_vat',     '6',
  'bill_tax_no_vat',  '10',
  'cf_sequel_no',     '1000000002',
  'cf_staff_member',  '1000000003',
  'staff_members',    jsonb_build_object('2', '1', '4', '2', '5', '3'),
  'unilever_client_id', 1,
  'raise_xano_invoices', false
))
on conflict (environment) do nothing;

-- Sandbox: filled in once the test company exists and its ids have been read.
-- Until then the raise refuses, naming this row.
insert into public.qbo_env_config (environment, config) values ('sandbox', jsonb_build_object(
  'app_url', 'https://app.sandbox.qbo.intuit.com',
  'ready', false
))
on conflict (environment) do nothing;

-- ── 4. sandbox customer and vendor ids ──────────────────────────────────────
create table if not exists public.qbo_id_map (
  environment text not null check (environment in ('sandbox')),
  kind        text not null check (kind in ('customer', 'vendor')),
  sequel_id   bigint not null,
  qbo_id      text not null,
  primary key (environment, kind, sequel_id)
);
alter table public.qbo_id_map enable row level security;
revoke all on public.qbo_id_map from anon, authenticated;

-- ── 5. the attempt log ──────────────────────────────────────────────────────
create table if not exists public.qbo_raise_attempts (
  id              bigint generated always as identity primary key,
  invoice_id      bigint not null,
  environment     text not null check (environment in ('production', 'sandbox')),
  doc_number      text not null,
  request_id      uuid not null,
  status          text not null default 'started'
                    check (status in ('started', 'failed', 'recorded', 'created_not_recorded')),
  qbo_invoice_id  text,
  error           text,
  result          jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists qbo_raise_attempts_invoice on public.qbo_raise_attempts (invoice_id);
alter table public.qbo_raise_attempts enable row level security;
revoke all on public.qbo_raise_attempts from anon, authenticated;

-- ── 6. the functions ────────────────────────────────────────────────────────

-- A customer or vendor id for one environment. Production reads the column
-- the vendor picker writes; sandbox reads the map.
create or replace function public.qbo_mapped_id(p_environment text, p_kind text, p_sequel_id bigint, p_production text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when p_environment = 'production' then nullif(btrim(p_production), '')
    else (select m.qbo_id from public.qbo_id_map m
           where m.environment = p_environment and m.kind = p_kind and m.sequel_id = p_sequel_id)
  end
$$;

-- The pre-flight. READ ONLY. The same list Xano's 574 returns, plus two the
-- new app needs. Returns { ok, problems[], summary }.
create or replace function public.qbo_raise_check(p_invoice_id bigint, p_environment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = xano_mirror, public, pg_catalog
as $$
declare
  inv        xano_mirror.invoices;
  cfg        jsonb;
  cli        xano_mirror.clients;
  cur_code   text;
  problems   text[] := '{}';
  bad_lines  int := 0;
  unmapped   int := 0;
  no_cur     int := 0;
  converted  int := 0;
  supplier_lines int := 0;
  vendors    text[] := '{}';
  l          record;
begin
  select * into inv from xano_mirror.invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Invoice not found.'));
  end if;
  select config into cfg from public.qbo_env_config where environment = p_environment;

  if cfg is null or (p_environment = 'sandbox' and coalesce((cfg ->> 'ready')::boolean, false) = false) then
    problems := problems || 'The QuickBooks test company is not set up yet.'::text;
  end if;

  -- ⚠️ New-app rule, not Xano's. Until the switch-over a Xano invoice is raised
  -- in the old app: a raise recorded here would be overwritten on the hour and
  -- the old app would offer to raise it again.
  if not inv.app_created and coalesce((cfg ->> 'raise_xano_invoices')::boolean, false) = false then
    problems := problems || 'This invoice belongs to the old app. Raise it there until the switch-over.'::text;
  end if;

  -- ⚠️ New-app rule: an earlier attempt that never finished must be looked at
  -- first. It may already be in QuickBooks. The raise itself reconciles a
  -- 'started' one; 'created_not_recorded' needs a person.
  if exists (select 1 from public.qbo_raise_attempts a
              where a.invoice_id = inv.id and a.status = 'created_not_recorded') then
    problems := problems || 'An earlier raise created this invoice in QuickBooks but could not record it here. Sort that out before raising again.'::text;
  end if;

  -- From here, Xano's list, in Xano's order and wording.
  if nullif(btrim(inv.qbo_invoice_id), '') is not null then
    problems := problems || 'This invoice has already been raised in QuickBooks.'::text;
  end if;
  if inv.status is distinct from 'Submitted' then
    problems := problems || 'Only a submitted invoice can be raised.'::text;
  end if;
  if coalesce(inv.client_id, 0) = 0 then
    problems := problems || 'No client selected.'::text;
  end if;
  if coalesce(inv.currency_id, 0) = 0 then
    problems := problems || 'No currency selected.'::text;
  end if;
  if nullif(btrim(inv.description), '') is null then
    problems := problems || 'No description.'::text;
  end if;
  if coalesce(inv.total_to_invoice, 0) <= 0 then
    problems := problems || 'Total to invoice is zero.'::text;
  end if;

  select c.currency into cur_code from xano_mirror.currencies_bank_accounts c where c.id = inv.currency_id;

  for l in
    select li.*, s.qbo_vendor_id as prod_vendor, s.default_currency_id as sup_currency_id,
           sc.currency as sup_code, s.id as sup_id
      from xano_mirror.invoice_line_items li
      left join xano_mirror.supplier_list s on s.id = li.supplier_id
      left join xano_mirror.currencies_bank_accounts sc on sc.id = s.default_currency_id
     where li.invoice_id = inv.id
  loop
    -- Sequel fee rows are Sequel's own money. Skipped, as Xano does (7 Sep).
    continue when l.line_type = 'sequel_fee';
    supplier_lines := supplier_lines + 1;

    if coalesce(l.supplier_id, 0) = 0 or coalesce(l.fee_amount, 0) <= 0 then
      bad_lines := bad_lines + 1;
    end if;

    if l.is_paythrough and coalesce(l.supplier_id, 0) > 0 then
      declare
        vend text := public.qbo_mapped_id(p_environment, 'vendor', l.sup_id, l.prod_vendor);
      begin
        if l.sup_id is null or vend is null then
          unmapped := unmapped + 1;
        elsif nullif(btrim(l.qbo_bill_id), '') is null then
          if not vend = any (vendors) then vendors := vendors || vend; end if;
          if coalesce(l.sup_currency_id, 0) = 0 or nullif(btrim(l.sup_code), '') is null then
            no_cur := no_cur + 1;
          elsif l.sup_code is distinct from cur_code then
            converted := converted + 1;
          end if;
        end if;
      end;
    end if;
  end loop;

  if bad_lines > 0 then
    problems := problems || 'Some supplier cost rows have no supplier or a zero amount.'::text;
  end if;
  if unmapped > 0 then
    problems := problems || 'Some paythrough suppliers are not linked to a QuickBooks vendor.'::text;
  end if;
  if no_cur > 0 then
    problems := problems || 'Some paythrough suppliers have no currency set, so their bill cannot be raised.'::text;
  end if;

  select * into cli from xano_mirror.clients where id = inv.client_id;
  if cli.id is null or public.qbo_mapped_id(p_environment, 'customer', cli.id, cli.qbo_customer_id) is null then
    problems := problems || 'This client is not linked to a QuickBooks customer.'::text;
  end if;
  if cli.id is null or coalesce(cli.country, 0) = 0 then
    problems := problems || 'This client has no country set, so the VAT code cannot be determined.'::text;
  end if;

  return jsonb_build_object(
    'ok', cardinality(problems) = 0,
    'problems', to_jsonb(problems),
    'summary', jsonb_build_object(
      'client_name', coalesce(cli.company, ''),
      'currency_code', coalesce(cur_code, ''),
      'total_to_invoice', inv.total_to_invoice,
      'gross_spend', inv.gross_spend,
      'sequel_profit', inv.total_sequel_profit,
      'line_count', supplier_lines,
      'bills_to_create', cardinality(vendors),
      'converted_bills', converted,
      'description', inv.description,
      'status', inv.status,
      'environment', p_environment
    )
  );
end
$$;

-- Everything the raise needs to build its payloads, in one read.
create or replace function public.qbo_raise_context(p_invoice_id bigint, p_environment text)
returns jsonb
language sql
stable
security definer
set search_path = xano_mirror, public, pg_catalog
as $$
  select jsonb_build_object(
    'config', (select config from public.qbo_env_config where environment = p_environment),
    'invoice', jsonb_build_object(
      'id', i.id, 'uuid', i.uuid, 'status', i.status, 'description', i.description,
      'total_to_invoice', i.total_to_invoice, 'po_number', i.po_number,
      'po_attachment_url', i.po_attachment_url, 'qbo_invoice_id', i.qbo_invoice_id,
      'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
      'music_supervisor_id', i.music_supervisor_id
    ),
    'currency_code', (select c.currency from currencies_bank_accounts c where c.id = i.currency_id),
    'client', (select jsonb_build_object(
                 'id', c.id, 'company', c.company, 'country', c.country,
                 'qbo_id', public.qbo_mapped_id(p_environment, 'customer', c.id, c.qbo_customer_id))
               from clients c where c.id = i.client_id),
    'project', (select jsonb_build_object(
                  'sequel_no', coalesce(p.sequel_no, ''), 'client', p.client,
                  'music_supervisor', p.music_supervisor)
                from project_master_list p where p.id = i.project_master_list_id),
    'owner_email', (select u.email from "user" u
                     where u.id = coalesce(nullif((select p.music_supervisor from project_master_list p
                                                     where p.id = i.project_master_list_id), 0),
                                           i.music_supervisor_id)),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', li.id, 'category', li.category, 'amount', li.fee_amount,
               'bill_id', li.qbo_bill_id, 'supplier_id', s.id, 'supplier', s.title,
               'vat_registered', coalesce(s.vat_registered, false),
               'currency', sc.currency,
               'vendor_id', public.qbo_mapped_id(p_environment, 'vendor', s.id, s.qbo_vendor_id))
             order by li.id)
        from invoice_line_items li
        join supplier_list s on s.id = li.supplier_id
        left join currencies_bank_accounts sc on sc.id = s.default_currency_id
       where li.invoice_id = i.id
         and li.line_type = 'third_party'
         and li.is_paythrough
    ), '[]'::jsonb)
  )
  from invoices i
  where i.id = p_invoice_id
$$;

-- The write-back. One statement, so the record can never carry a QuickBooks
-- id without the status that goes with it (Xano 575's db.edit). Refuses to
-- overwrite an id that is already there.
create or replace function public.qbo_record_raise(
  p_invoice_id bigint, p_qbo_id text, p_number text, p_date date, p_due date,
  p_rate numeric, p_home_total numeric
)
returns boolean
language plpgsql
security definer
set search_path = xano_mirror, public, pg_catalog
as $$
begin
  update xano_mirror.invoices set
    qbo_invoice_id     = p_qbo_id,
    invoice_number     = p_number,
    invoice_date       = p_date,
    due_date           = p_due,
    exchange_rate_lock = coalesce(p_rate, 0),
    gbp_total_amount   = coalesce(p_home_total, 0),
    status             = 'Awaiting Payment'
  where id = p_invoice_id
    and nullif(btrim(qbo_invoice_id), '') is null;
  return found;
end
$$;

-- Written the moment a bill lands, on every line it covers, so a retry skips
-- them (Xano's resumability rule).
create or replace function public.qbo_mark_bill(p_line_ids bigint[], p_bill_id text)
returns int
language sql
security definer
set search_path = xano_mirror, public, pg_catalog
as $$
  with u as (
    update xano_mirror.invoice_line_items set qbo_bill_id = p_bill_id
     where id = any (p_line_ids) and nullif(btrim(qbo_bill_id), '') is null
    returning 1
  )
  select count(*)::int from u
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.qbo_mapped_id(text, text, bigint, text)',
    'public.qbo_raise_check(bigint, text)',
    'public.qbo_raise_context(bigint, text)',
    'public.qbo_record_raise(bigint, text, text, date, date, numeric, numeric)',
    'public.qbo_mark_bill(bigint[], text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 7. one raise at a time ──────────────────────────────────────────────────
-- (Applied separately as 0037b.) A second raise of the same invoice cannot
-- insert its attempt while the first is still 'started', so a double click or
-- two tabs cannot create two QuickBooks invoices.
create unique index if not exists qbo_raise_attempts_one_started
  on public.qbo_raise_attempts (invoice_id)
  where status = 'started';
