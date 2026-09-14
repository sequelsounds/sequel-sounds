-- Who the signed-in person is on the Xano side. The projects list needs their
-- name for the header and their id to filter to their own projects, and
-- track_user_id() alone gives only the id.
create or replace function public.track_me()
returns table (id bigint, name text, email text)
language sql stable security definer set search_path = public, xano_mirror, pg_catalog as $fn$
  select u.id, u.name, u.email
    from xano_mirror."user" u
   where u.id = public.track_user_id();
$fn$;

revoke all on function public.track_me() from public;
grant execute on function public.track_me() to authenticated;
