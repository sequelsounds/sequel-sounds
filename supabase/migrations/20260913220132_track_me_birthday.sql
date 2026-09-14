-- /dashboard's greeting beats every other line on the caller's birthday, so
-- track_me has to carry the date.
--
-- ⚠️ Only the caller's own row, and only because it is their own: the function
-- is already keyed on track_user_id(), so nobody reads anyone else's. A date
-- of birth is personal data and should not travel further than this.
drop function if exists public.track_me();

create function public.track_me()
returns table(id bigint, name text, email text, birthday date)
language sql
stable
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $$
  select u.id, u.name, u.email, u.birthday
    from xano_mirror."user" u
   where u.id = public.track_user_id();
$$;

