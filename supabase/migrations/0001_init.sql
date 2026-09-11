-- 0001_init.sql — Sequel Sounds core schema
-- Staff = the 3 Supabase Auth users. Everyone else is anonymous and acts
-- through a share token sent as the `x-share-token` request header.

-- ---------------------------------------------------------------------------
-- Private helper schema (not exposed to PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated;

-- 32 hex chars (~122 bits) from a v4 uuid; no extension needed.
create or replace function app.new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

-- The token on the current request, if any.
create or replace function app.request_token()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    current_setting('request.headers', true)::json ->> 'x-share-token',
    ''
  )
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.track_kind as enum ('audio', 'video');
create type public.track_status as enum ('new', 'shortlisted', 'rejected');
create type public.processing_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.comment_target as enum ('track', 'video');

-- ---------------------------------------------------------------------------
-- Mirrors (written only by the Xano webhook via service_role; read-only here)
-- ---------------------------------------------------------------------------
create table public.projects_mirror (
  id           uuid primary key default gen_random_uuid(),
  xano_id      text not null unique,
  name         text not null,
  client_name  text,
  status       text,
  brief        text,
  starts_on    date,
  ends_on      date,
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table public.suppliers_mirror (
  id            uuid primary key default gen_random_uuid(),
  xano_id       text not null unique,
  name          text not null,
  contact_email text,
  notes         text,
  raw           jsonb,
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inboxes — exactly one per project, created automatically
-- ---------------------------------------------------------------------------
create table public.inboxes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects_mirror(id) on delete cascade,
  token      text not null unique default app.new_token(),
  label      text,
  is_active  boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.create_inbox_for_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inboxes (project_id)
  values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

create trigger projects_mirror_create_inbox
after insert on public.projects_mirror
for each row execute function public.create_inbox_for_project();

-- Resolves the inbox for the current request token, if it is live.
create or replace function app.current_inbox_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
  from public.inboxes i
  where i.token = app.request_token()
    and i.is_active
    and (i.expires_at is null or i.expires_at > now())
$$;

-- ---------------------------------------------------------------------------
-- Tracks
-- ---------------------------------------------------------------------------
create table public.tracks (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects_mirror(id) on delete cascade,
  inbox_id           uuid references public.inboxes(id) on delete set null,
  supplier_id        uuid references public.suppliers_mirror(id) on delete set null,
  kind               public.track_kind not null default 'audio',

  -- metadata supplied at upload
  title              text not null,
  artist             text,
  composer           text,
  contact_email      text,
  publisher          text,
  writers            text,
  label              text,
  notes              text,

  -- file + Lambda output
  s3_key             text,
  original_filename  text,
  mime_type          text,
  size_bytes         bigint,
  duration_seconds   numeric(10, 3),
  preview_key        text,
  waveform_peaks     jsonb,
  processing_status  public.processing_status not null default 'pending',
  processing_error   text,

  status             public.track_status not null default 'new',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index tracks_project_id_idx on public.tracks (project_id);
create index tracks_inbox_id_idx on public.tracks (inbox_id);
create index tracks_status_idx on public.tracks (project_id, status);

-- ---------------------------------------------------------------------------
-- Playlists
-- ---------------------------------------------------------------------------
create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects_mirror(id) on delete cascade,
  name        text not null,
  description text,
  token       text not null unique default app.new_token(),
  is_active   boolean not null default true,
  expires_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index playlists_project_id_idx on public.playlists (project_id);

create or replace function app.current_playlist_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.playlists p
  where p.token = app.request_token()
    and p.is_active
    and (p.expires_at is null or p.expires_at > now())
$$;

create table public.playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id    uuid not null references public.tracks(id) on delete cascade,
  position    integer not null default 0,
  note        text,
  created_at  timestamptz not null default now(),
  unique (playlist_id, track_id)
);

create index playlist_tracks_order_idx on public.playlist_tracks (playlist_id, position);

create table public.playlist_themes (
  playlist_id      uuid primary key references public.playlists(id) on delete cascade,
  logo_url         text,
  background_url   text,
  background_color text,
  text_color       text,
  accent_color     text,
  heading          text,
  font_family      text,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Viewers + comments
-- ---------------------------------------------------------------------------
create table public.viewers (
  id            uuid primary key default gen_random_uuid(),
  playlist_id   uuid not null references public.playlists(id) on delete cascade,
  name          text not null,
  email         text not null,
  view_count    integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  user_agent    text,
  unique (playlist_id, email)
);

create index viewers_playlist_id_idx on public.viewers (playlist_id);

-- target_id references public.tracks(id) for both target types; `target_type`
-- records whether the timestamp is against the audio or the video asset.
create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  playlist_id       uuid not null references public.playlists(id) on delete cascade,
  target_type       public.comment_target not null default 'track',
  target_id         uuid not null references public.tracks(id) on delete cascade,
  viewer_id         uuid references public.viewers(id) on delete set null,
  author_name       text not null,
  body              text not null,
  timestamp_seconds numeric(10, 3),
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index comments_playlist_id_idx on public.comments (playlist_id);
create index comments_target_idx on public.comments (target_id, target_type);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tracks_touch before update on public.tracks
for each row execute function public.touch_updated_at();
create trigger playlists_touch before update on public.playlists
for each row execute function public.touch_updated_at();
create trigger playlist_themes_touch before update on public.playlist_themes
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Viewer registration (anon cannot read the viewers table directly)
-- ---------------------------------------------------------------------------
create or replace function public.register_viewer(p_name text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_playlist uuid := app.current_playlist_id();
  v_id uuid;
begin
  if v_playlist is null then
    raise exception 'invalid or expired playlist token';
  end if;

  insert into public.viewers as v (playlist_id, name, email, user_agent)
  values (
    v_playlist,
    p_name,
    lower(trim(p_email)),
    current_setting('request.headers', true)::json ->> 'user-agent'
  )
  on conflict (playlist_id, email) do update
    set name = excluded.name,
        view_count = v.view_count + 1,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_viewer(text, text) from public;
grant execute on function public.register_viewer(text, text) to anon, authenticated;

create or replace function app.viewer_in_playlist(p_viewer uuid, p_playlist uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.viewers v
    where v.id = p_viewer and v.playlist_id = p_playlist
  )
$$;

grant execute on function app.new_token(), app.request_token(), app.is_staff(),
  app.current_inbox_id(), app.current_playlist_id(),
  app.viewer_in_playlist(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.projects_mirror  enable row level security;
alter table public.suppliers_mirror enable row level security;
alter table public.inboxes          enable row level security;
alter table public.tracks           enable row level security;
alter table public.playlists        enable row level security;
alter table public.playlist_tracks  enable row level security;
alter table public.playlist_themes  enable row level security;
alter table public.viewers          enable row level security;
alter table public.comments         enable row level security;

-- Mirrors: staff read only. The Xano webhook writes with service_role, which
-- bypasses RLS entirely.
create policy staff_read on public.projects_mirror
  for select to authenticated using (app.is_staff());

create policy staff_read on public.suppliers_mirror
  for select to authenticated using (app.is_staff());

-- A token holder may read the one project their link belongs to.
create policy token_read on public.projects_mirror
  for select to anon using (
    id = (select i.project_id from public.inboxes i where i.id = app.current_inbox_id())
    or id = (select p.project_id from public.playlists p where p.id = app.current_playlist_id())
  );

-- Inboxes
create policy staff_all on public.inboxes
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy token_read on public.inboxes
  for select to anon using (id = app.current_inbox_id());

-- Tracks: staff do everything. Partners may only insert into their own inbox.
-- Playlist viewers may read the tracks on their playlist.
create policy staff_all on public.tracks
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy inbox_insert on public.tracks
  for insert to anon with check (
    inbox_id is not null
    and inbox_id = app.current_inbox_id()
    and project_id = (select i.project_id from public.inboxes i where i.id = app.current_inbox_id())
    and status = 'new'
    and processing_status = 'pending'
  );

create policy playlist_read on public.tracks
  for select to anon using (
    exists (
      select 1 from public.playlist_tracks pt
      where pt.track_id = tracks.id
        and pt.playlist_id = app.current_playlist_id()
    )
  );

-- Playlists and their contents
create policy staff_all on public.playlists
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy token_read on public.playlists
  for select to anon using (id = app.current_playlist_id());

create policy staff_all on public.playlist_tracks
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy token_read on public.playlist_tracks
  for select to anon using (playlist_id = app.current_playlist_id());

create policy staff_all on public.playlist_themes
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy token_read on public.playlist_themes
  for select to anon using (playlist_id = app.current_playlist_id());

-- Viewers: staff read. Anon never touches this table directly — only through
-- public.register_viewer().
create policy staff_read on public.viewers
  for select to authenticated using (app.is_staff());

-- Comments
create policy staff_all on public.comments
  for all to authenticated using (app.is_staff()) with check (app.is_staff());

create policy token_read on public.comments
  for select to anon using (playlist_id = app.current_playlist_id());

create policy token_insert on public.comments
  for insert to anon with check (
    playlist_id = app.current_playlist_id()
    and viewer_id is not null
    and app.viewer_in_playlist(viewer_id, app.current_playlist_id())
    and target_id in (
      select pt.track_id from public.playlist_tracks pt
      where pt.playlist_id = app.current_playlist_id()
    )
  );
