-- 15 Sep 2026. The new app's own QuickBooks connection.
--
-- Andy's call: the new app talks to QuickBooks itself rather than asking Xano.
-- It does so through a SEPARATE Intuit app, "Sequel App New", so that nothing
-- here can touch the old app's live connection (Xano table 65), which raises
-- real invoices. Intuit's refresh token rotates, and two systems refreshing one
-- connection knock each other out; two Intuit apps are two connections.
--
-- ⚠️ THESE ROWS ARE CREDENTIALS. RLS is on and there are NO policies, and
-- every privilege is revoked from anon and authenticated, so nothing reaches
-- them through the API. Only the edge functions, as service_role, read or
-- write them. Never add a policy, never return a row, never log one.

create table if not exists public.qbo_connection (
  environment         text primary key check (environment = 'production'),
  realm_id            text not null,
  access_token        text,
  refresh_token       text,
  access_expires_at   timestamptz,
  refresh_expires_at  timestamptz,
  status              text not null default 'Connected'
                        check (status in ('Connected', 'Error')),
  last_error          text,
  connected_by        uuid,
  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- One refresh at a time. See qbo_claim_refresh.
  refresh_lock_id     uuid,
  refresh_lock_until  timestamptz
);

-- An OAuth handshake in flight. The state value is the whole protection on
-- the unauthenticated callback: the callback looks the row up BY state and
-- deletes it, so an unknown or replayed state finds nothing.
create table if not exists public.qbo_oauth_state (
  state       text primary key,
  user_id     uuid not null,
  return_to   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes'
);

alter table public.qbo_connection  enable row level security;
alter table public.qbo_oauth_state enable row level security;
revoke all on public.qbo_connection  from anon, authenticated;
revoke all on public.qbo_oauth_state from anon, authenticated;

-- ⚠️ ALL REFRESHING GOES THROUGH HERE. Intuit rotates the refresh token, so two
-- concurrent refreshes leave one caller holding a dead token and the
-- connection has to be re-authorised by hand. Returns:
--   'fresh'   the access token is still good for 2+ minutes; use it
--   'claimed' this caller holds the lock and must refresh, then release it
--   'busy'    someone else is refreshing; wait and read the row again
--   'none'    not connected
create or replace function public.qbo_claim_refresh(p_lock uuid, p_seconds int default 30)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.qbo_connection;
begin
  select * into r from public.qbo_connection
   where environment = 'production'
   for update;

  if not found or r.refresh_token is null then
    return 'none';
  end if;

  if r.access_token is not null
     and r.access_expires_at > now() + interval '2 minutes' then
    return 'fresh';
  end if;

  if r.refresh_lock_until is not null and r.refresh_lock_until > now() then
    return 'busy';
  end if;

  update public.qbo_connection
     set refresh_lock_id = p_lock,
         refresh_lock_until = now() + make_interval(secs => p_seconds)
   where environment = 'production';
  return 'claimed';
end
$$;

revoke all on function public.qbo_claim_refresh(uuid, int) from public, anon, authenticated;
grant execute on function public.qbo_claim_refresh(uuid, int) to service_role;
