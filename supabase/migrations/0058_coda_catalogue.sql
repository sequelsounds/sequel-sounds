-- What Coda can read, discovered rather than listed.
--
-- The alternative was a hand-written catalogue in the edge function, which
-- would have gone stale the first time a page added a view — and Andy's
-- requirement is that Coda keeps up with the app as it is built, without a
-- deploy each time. So the read surface IS the set of views, and a new view is
-- available to her the moment it exists.
--
-- Views only, never base tables: the views are the curated surface, and the
-- base tables include columns like the login code that nothing should offer up
-- for browsing. Row-level security still decides what any of it returns.
create or replace function public.coda_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = public, xano_mirror
as $$
  with cols as (
    select
      c.table_schema,
      c.table_name,
      jsonb_agg(
        jsonb_build_object('name', c.column_name, 'type', c.data_type)
        order by c.ordinal_position
      ) as columns
    from information_schema.columns c
    join information_schema.views v
      on v.table_schema = c.table_schema and v.table_name = c.table_name
    where c.table_schema = 'xano_mirror'
    group by c.table_schema, c.table_name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'resource', table_name,
        'schema',   table_schema,
        'columns',  columns
      )
      order by table_name
    ),
    '[]'::jsonb
  )
  from cols
$$;

grant execute on function public.coda_catalogue() to authenticated;

comment on function public.coda_catalogue is
  'Every view Coda may read, with its columns. Discovered from the catalog so a
   view added for a new page is available to her without a deploy.';
