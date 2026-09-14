-- The guards must stay callable by `authenticated` (RLS policy expressions are
-- evaluated as the calling role), but nothing here is any use before sign-in.
revoke execute on function public.track_is_staff()      from anon, public;
revoke execute on function public.track_is_finance()    from anon, public;
revoke execute on function public.track_is_management() from anon, public;
revoke execute on function public.track_user_id()       from anon, public;
revoke execute on function public.track_company_id()    from anon, public;

grant execute on function public.track_is_staff()      to authenticated;
grant execute on function public.track_is_finance()    to authenticated;
grant execute on function public.track_is_management() to authenticated;
grant execute on function public.track_user_id()       to authenticated;
grant execute on function public.track_company_id()    to authenticated;

-- Trigger function: never callable over the API by anyone.
revoke execute on function public.track_link_auth_user() from anon, authenticated, public;

-- track_users is reachable only through its RLS policies.
revoke all on table public.track_users from anon;
grant select, insert, update, delete on table public.track_users to authenticated;
