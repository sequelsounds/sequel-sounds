-- 15 Sep 2026. Why the hourly sync had been failing on eight tables.
--
-- The mirror has real foreign keys and CHECK constraints; Xano has neither.
-- Xano writes 0 into an unset link and "" into an unset enum, and the sync
-- passed both straight through. One such row fails the whole table's push —
-- nothing upserted, nothing deleted — so projects, quotes, quote lines,
-- invoices, invoice lines, contracts, project assets and the QuickBooks
-- connection had taken no change from Xano for at least a day (the edge
-- logs only reach back 24 hours).
--
-- This tells the sync, per column, which of Xano's "unset" values to turn into
-- null on the way in:
--
--   zero_is_null   the column is (the single column of) a foreign key. Xano
--                  ids start at 1, so 0 is never a real parent.
--   blank_is_null  the column is text and a CHECK constraint names it. Those
--                  are the enum columns, and none of them lists "".
--
-- Text columns without a constraint keep "" — there, "" and null can mean
-- different things.
create or replace function public.xano_mirror_column_rules(p_table text)
returns table(column_name text, data_type text, zero_is_null boolean, blank_is_null boolean)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with rel as (
    select c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'xano_mirror' and c.relname = p_table
  ),
  att as (
    -- attnum, not information_schema's ordinal_position: constraint keys are
    -- attnums, and the two only agree while no column has ever been dropped.
    select a.attname::text as name, a.attnum
      from pg_attribute a, rel
     where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  )
  select
    col.column_name::text,
    col.data_type::text,
    exists (
      select 1 from pg_constraint k, rel
       where k.conrelid = rel.oid and k.contype = 'f'
         and array_length(k.conkey, 1) = 1
         and k.conkey[1] = att.attnum
    ) as zero_is_null,
    col.data_type in ('text', 'character varying') and exists (
      select 1 from pg_constraint k, rel
       where k.conrelid = rel.oid and k.contype = 'c'
         and k.conkey @> array[att.attnum]
    ) as blank_is_null
  from information_schema.columns col
  join att on att.name = col.column_name
  where col.table_schema = 'xano_mirror'
    and col.table_name = p_table
  order by att.attnum;
$function$;

revoke all on function public.xano_mirror_column_rules(text) from public, anon, authenticated;
grant execute on function public.xano_mirror_column_rules(text) to service_role;
