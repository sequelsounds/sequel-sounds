-- The front door for Claude on the desktop.
--
-- Claude connects to /mcp over OAuth. These two tables are the whole of the
-- state it needs: who registered, and the one-time codes handed out when a
-- person presses Allow.
--
-- ⚠️ NOTHING HERE ISSUES A SESSION. The code proves that a signed-in member of
-- staff pressed Allow in their own browser; the token endpoint then asks
-- Supabase Auth for a real session for that person. Claude ends up holding an
-- ordinary access token, so every MCP call runs as them and RLS decides
-- exactly as it does in the app. There is deliberately no path where the
-- function acts as one person while claiming to be another.

create table if not exists public.coda_clients (
  id            uuid primary key default gen_random_uuid(),
  client_id     text unique not null,
  client_name   text,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.coda_auth_codes (
  code           text primary key,
  client_id      text not null references public.coda_clients(client_id) on delete cascade,
  auth_uid       uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text,
  expires_at     timestamptz not null default now() + interval '2 minutes',
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists coda_auth_codes_expires on public.coda_auth_codes (expires_at);

alter table public.coda_clients     enable row level security;
alter table public.coda_auth_codes  enable row level security;

-- No policies on either table, on purpose: only the token endpoint touches
-- them, and it holds the service role. A signed-in person reaches them solely
-- through the function below, which decides what they may do.
revoke all on public.coda_clients    from anon, authenticated;
revoke all on public.coda_auth_codes from anon, authenticated;

-- Pressing Allow.
create or replace function public.coda_authorize(
  p_client_id      text,
  p_redirect_uri   text,
  p_code_challenge text,
  p_scope          text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text;
  v_client public.coda_clients%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.track_is_staff() then
    raise exception 'Refused: only Sequel staff can connect an assistant.'
      using errcode = '42501';
  end if;

  select * into v_client from public.coda_clients c where c.client_id = p_client_id;
  if not found then
    raise exception 'Unknown client.' using errcode = '23503';
  end if;

  -- The redirect must be one the client registered. Without this check a code
  -- could be steered to somebody else's address.
  if not (p_redirect_uri = any (v_client.redirect_uris)) then
    raise exception 'That redirect address is not registered for this client.'
      using errcode = '23514';
  end if;

  if p_code_challenge is null or length(p_code_challenge) < 43 then
    raise exception 'A PKCE challenge is required.' using errcode = '23514';
  end if;

  v_code := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.coda_auth_codes
    (code, client_id, auth_uid, redirect_uri, code_challenge, scope)
  values
    (v_code, p_client_id, auth.uid(), p_redirect_uri, p_code_challenge, p_scope);

  return v_code;
end
$$;

revoke execute on function public.coda_authorize(text, text, text, text) from public, anon;
grant   execute on function public.coda_authorize(text, text, text, text) to authenticated;

create or replace function public.coda_client_name(p_client_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select case when public.track_is_staff()
              then (select c.client_name from public.coda_clients c
                     where c.client_id = p_client_id)
         end
$$;

revoke execute on function public.coda_client_name(text) from public, anon;
grant   execute on function public.coda_client_name(text) to authenticated;
