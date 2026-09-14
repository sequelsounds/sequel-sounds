-- Track's user allowlist. A row here is what permits an email to sign in and
-- determines what they can see. Mirrors Studio's public.staff pattern, widened
-- to cover Track's full user model.
create table if not exists public.track_users (
  id                bigint primary key,                                  -- Xano user id, kept so mirrored references stay valid
  auth_user_id      uuid unique references auth.users(id) on delete set null,
  email             text unique,                                         -- allowlist key; null = cannot sign in
  full_name         text,
  user_type         text not null check (user_type in ('Admin','Sequel','Agency','Brand','Adpro','Freelance','Supplier')),
  status            text not null check (status in ('Active','Pending','Blocked','Archived')),
  company_client_id bigint,                                              -- -> clients.id (no FK: the mirror is rebuilt on resync)
  job_title         text,
  is_finance        boolean not null default false,
  is_management     boolean not null default false,
  created_at        timestamptz not null default now()
);

comment on table public.track_users is
  'Allowlist for Sequel Track. A row grants sign-in; user_type and the is_* flags drive RLS. Seeded from Xano; auth_user_id is filled on first sign-in.';

-- Seed from the mirror
insert into public.track_users
  (id, email, full_name, user_type, status, company_client_id, job_title, is_finance, is_management, created_at)
select u.id,
       nullif(lower(trim(u.email)), ''),
       nullif(trim(u.name), ''),
       ut.user_type,
       st.status,
       u.company,
       nullif(trim(u.job_title), ''),
       coalesce(u.finance_user, false),
       coalesce(u.management, false),
       coalesce(u.created_at, now())
from xano_mirror."user" u
join xano_mirror.user_types    ut on ut.id = u.user_type
join xano_mirror.user_statuses st on st.id = u.status
on conflict (id) do nothing;

-- Link an auth account to its allowlist row on first sign-in, by email
create or replace function public.track_link_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  update public.track_users
     set auth_user_id = new.id
   where auth_user_id is null
     and email is not null
     and email = lower(trim(new.email));
  return new;
end
$fn$;

drop trigger if exists track_link_auth_user on auth.users;
create trigger track_link_auth_user
  after insert on auth.users
  for each row execute function public.track_link_auth_user();

-- Backfill for auth accounts that already exist (Studio's three staff)
update public.track_users t
   set auth_user_id = a.id
  from auth.users a
 where t.auth_user_id is null
   and t.email is not null
   and t.email = lower(trim(a.email));

-- Guards, replacing Xano's assert_* functions
create or replace function public.track_is_staff() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and user_type in ('Admin','Sequel')
                    and status = 'Active');
$fn$;

create or replace function public.track_is_finance() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and is_finance
                    and status = 'Active');
$fn$;

create or replace function public.track_is_management() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select exists (select 1 from public.track_users
                  where auth_user_id = auth.uid()
                    and is_management
                    and status = 'Active');
$fn$;

-- The signed-in user's Track id, for project scoping
create or replace function public.track_user_id() returns bigint
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select id from public.track_users
   where auth_user_id = auth.uid()
     and status in ('Active','Pending');
$fn$;

-- The client company the signed-in user belongs to
create or replace function public.track_company_id() returns bigint
language sql stable security definer set search_path = public, pg_catalog as $fn$
  select company_client_id from public.track_users
   where auth_user_id = auth.uid()
     and status in ('Active','Pending');
$fn$;

alter table public.track_users enable row level security;

create policy track_users_read_own on public.track_users
  for select to authenticated using (auth_user_id = auth.uid());

create policy track_users_staff_read_all on public.track_users
  for select to authenticated using (public.track_is_staff());

create policy track_users_staff_write on public.track_users
  for all to authenticated using (public.track_is_staff()) with check (public.track_is_staff());
