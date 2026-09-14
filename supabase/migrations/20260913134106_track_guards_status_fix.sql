-- 'Pending' is not a reliable signal: a legacy set_all_users_to_pending task left
-- 75 of 149 users Pending, including two of the three Sequel staff. Access is
-- therefore decided by user_type and the is_* flags; status only ever denies.
create or replace function public.track_is_staff() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and user_type in ('Admin','Sequel')
                    and status not in ('Blocked','Archived'));
$fn$;

create or replace function public.track_is_finance() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and is_finance
                    and status not in ('Blocked','Archived'));
$fn$;

create or replace function public.track_is_management() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and is_management
                    and status not in ('Blocked','Archived'));
$fn$;

create or replace function public.track_user_id() returns bigint
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select id from public.track_users
   where auth_user_id = auth.uid()
     and status not in ('Blocked','Archived');
$fn$;

create or replace function public.track_company_id() returns bigint
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select company_client_id from public.track_users
   where auth_user_id = auth.uid()
     and status not in ('Blocked','Archived');
$fn$;
