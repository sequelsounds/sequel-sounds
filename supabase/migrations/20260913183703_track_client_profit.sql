-- public.track_client_profit — Track's get_client_profit (api 589), recreated
-- statement for statement. It feeds the two profit tiles on /client.
--
-- The rate is `exchange_rate_lock`, the rate QuickBooks applied on the day,
-- stamped per invoice — NOT `eur_rate`, which is Unilever's fixed reporting
-- table and lands about 2% out on USD and JPY. Because the rate is stamped,
-- a historic total never moves when rates change.
--
-- Profit is `total_sequel_profit`: every Sequel fee including studio fees and
-- contingency, no supplier lines. NOT `total_service_fees`, which drops studio
-- fees and contingency because Unilever read those as third-party cost.
-- Similar names, very different numbers.
--
-- Excluded, both exactly as Xano does it:
--   * archived invoices — `is distinct from 'Archived'`, so a blank status
--     still counts;
--   * any invoice whose exchange_rate_lock is 0, which means the QuickBooks
--     rate was never pulled. Counting those at zero would quietly understate
--     profit, so they come back as `invoices_unrated` instead: visible rather
--     than silent.
-- An invoice with no invoice_date cannot be placed in a year, so it lands in
-- the total and not in year-to-date. Year-to-date is calendar, Jan–Dec, which
-- is how the Unilever reporting years are cut.
--
-- The year is an argument rather than now(), as in Xano: the page passes
-- new Date().getFullYear(), which also lets a past year be asked for.
--
-- SECURITY INVOKER deliberately. Xano's endpoint is auth: 1 with no finance
-- gate, so on Track any signed-in account — a client user included — can ask
-- for any client's margin. Here the RLS on xano_mirror.invoices decides, so
-- the same call returns only what the caller may already read. That is a
-- divergence from Track and the safe direction of one.
create or replace function public.track_client_profit(p_client bigint, p_year int)
returns table (
  client_id bigint,
  year int,
  total_profit_gbp numeric,
  ytd_profit_gbp numeric,
  invoices_counted bigint,
  invoices_unrated bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p_client,
    p_year,
    coalesce(sum(i.total_sequel_profit * i.exchange_rate_lock)
      filter (where coalesce(i.exchange_rate_lock, 0) <> 0), 0),
    coalesce(sum(i.total_sequel_profit * i.exchange_rate_lock)
      filter (where coalesce(i.exchange_rate_lock, 0) <> 0
                and i.invoice_date is not null
                and i.invoice_date >= make_date(p_year, 1, 1)
                and i.invoice_date <= make_date(p_year, 12, 31)), 0),
    count(*) filter (where coalesce(i.exchange_rate_lock, 0) <> 0),
    count(*) filter (where coalesce(i.exchange_rate_lock, 0) = 0)
  from xano_mirror.invoices i
  where i.client_id = p_client
    and i.status is distinct from 'Archived';
$$;

grant execute on function public.track_client_profit(bigint, int) to authenticated;
revoke execute on function public.track_client_profit(bigint, int) from anon;
