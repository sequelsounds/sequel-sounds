-- 15 Sep 2026. Archiving a quote from the project page's Estimates list.
--
-- The old app's delete icon calls Xano's archive_quote, which sets status
-- "Archived" and nothing else; get_projects_quotes_by_uuid then leaves the
-- row out. Nothing is hard-deleted — Andy, 15 Sep: "we don't hard delete very
-- often". Any Sequel staff member can archive a quote, as in the old app.
create or replace function public.track_archive_quote(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can archive a quote.' using errcode = '42501';
  end if;

  update xano_mirror.quotes q
     set status = 'Archived'
   where q.id = p_quote_id;

  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
end
$function$;

revoke all on function public.track_archive_quote(bigint) from public, anon;
grant execute on function public.track_archive_quote(bigint) to authenticated;
