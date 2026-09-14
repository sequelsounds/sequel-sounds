-- The sync function needs to know each column's type so it can turn Xano's
-- shapes into Postgres ones: epoch milliseconds into timestamps, and the empty
-- strings Xano sends for unset numbers, dates and uuids into nulls. Reading it
-- from the catalogue rather than hardcoding a map means the sync does not go
-- stale when a column is added in Xano.
create or replace function public.xano_mirror_columns(p_table text)
returns table (column_name text, data_type text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'xano_mirror'
    and c.table_name = p_table
  order by c.ordinal_position;
$fn$;

-- Server-to-server only. Nothing signed in through the app has any use for it.
revoke execute on function public.xano_mirror_columns(text) from public, anon, authenticated;
grant execute on function public.xano_mirror_columns(text) to service_role;
