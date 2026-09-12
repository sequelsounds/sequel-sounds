-- 0006 — the Studio model (docs/product-spec.md, 12 Sep 2026).
--
-- The init schema was written for an older shape: tracks had a status,
-- playlists belonged to exactly one project, and viewers were anonymous rows.
-- This brings the database to the spec in one pass. The live database held no
-- tracks, playlists or viewers when it ran, so nothing here migrates data.

-- ---------------------------------------------------------------------------
-- Staff are an allowlist, not "anyone signed in".
--
-- Viewers become Supabase Auth users in phase 3, so `auth.uid() is not null`
-- stops meaning staff the moment the first client signs in. This has to land
-- before that, which is why it is first.
-- ---------------------------------------------------------------------------
create table public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.staff is
  'Allowlist. A row here is what makes an auth user staff; add a fourth member of staff by inserting one.';

-- Every account that exists today is staff — accounts were only ever created
-- by hand for the three of them.
insert into public.staff (user_id, email)
select id, email from auth.users where email is not null
on conflict do nothing;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s where s.user_id = (select auth.uid())
  )
$$;

alter table public.staff enable row level security;

-- Staff can see who else is staff. Nobody else sees the table, and nothing
-- writes to it through the API — that is a dashboard/SQL operation.
create policy staff_read on public.staff
  for select to authenticated using ((select app.is_staff()));

-- ---------------------------------------------------------------------------
-- Tracks have no status. The only things you do with an inbox track are play
-- it and drag it into a playlist.
-- ---------------------------------------------------------------------------
drop policy inbox_insert on public.tracks;
drop index if exists public.tracks_status_idx;
alter table public.tracks drop column status;
drop type public.track_status;

-- One partner drop = one submission. The inbox page mints the id per send so
-- the staff inbox can stack a drop as one expandable group instead of
-- guessing from timestamps.
alter table public.tracks add column submission_id uuid;
create index tracks_submission_idx on public.tracks (project_id, submission_id);
create index tracks_created_idx on public.tracks (project_id, created_at desc);

comment on column public.tracks.submission_id is
  'Groups one partner drop. Minted by the inbox page per send; null only for rows that predate it.';

create policy inbox_insert on public.tracks
  for insert to anon with check (
    inbox_id is not null
    and inbox_id = (select app.current_inbox_id())
    and project_id = (select i.project_id from public.inboxes i where i.id = (select app.current_inbox_id()))
    and processing_status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- Playlists: optionally attached to a project, with named sections, one
-- attached picture, and two switches.
-- ---------------------------------------------------------------------------
alter table public.playlists
  alter column project_id drop not null,
  add column video_track_id    uuid references public.tracks(id) on delete set null,
  add column require_sign_in   boolean not null default true,
  add column visible_to_client boolean not null default false;

create index playlists_video_track_idx on public.playlists (video_track_id) where video_track_id is not null;
create index playlists_created_by_idx on public.playlists (created_by);

comment on column public.playlists.video_track_id is
  'The "picture": one video track shown above the list on the viewer page. Independent of video tracks placed in sections.';
comment on column public.playlists.require_sign_in is
  'Viewers must sign in (email + code) to open the link. Off = open link.';
comment on column public.playlists.visible_to_client is
  'Appears in the client''s Sequel Track project. Independent of the link.';

create table public.playlist_sections (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index playlist_sections_order_idx on public.playlist_sections (playlist_id, position);

alter table public.playlist_tracks
  add column section_id          uuid references public.playlist_sections(id) on delete set null,
  add column sync_offset_seconds numeric(10, 3);

create index playlist_tracks_section_idx on public.playlist_tracks (section_id);
create index playlist_tracks_track_idx on public.playlist_tracks (track_id);

comment on column public.playlist_tracks.sync_offset_seconds is
  'Staff preset: where the music sits against the picture when the viewer page opens. Seconds into the video at which the track starts; negative means the track starts before the picture.';

-- ---------------------------------------------------------------------------
-- Sequel Track project assets, mirrored by the same webhook. When one is
-- picked as a picture the file is copied into the media bucket and becomes a
-- video track; `track_id` records which.
-- ---------------------------------------------------------------------------
create table public.project_assets (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects_mirror(id) on delete cascade,
  xano_id      text not null unique,
  name         text not null,
  source_bucket text,
  source_key   text,
  mime_type    text,
  size_bytes   bigint,
  track_id     uuid references public.tracks(id) on delete set null,
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index project_assets_project_idx on public.project_assets (project_id);
create index project_assets_track_idx on public.project_assets (track_id) where track_id is not null;

-- ---------------------------------------------------------------------------
-- Viewers. Phase 3 makes them auth users; the profile is asked for once.
-- `viewers` stays as the per-playlist record of who opened what.
-- ---------------------------------------------------------------------------
create type public.viewer_type as enum (
  'brand', 'agency', 'production_company', 'director', 'sound_post', 'composer', 'other'
);

create table public.viewer_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null,
  company    text,
  user_type  public.viewer_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger viewer_profiles_touch before update on public.viewer_profiles
for each row execute function public.touch_updated_at();

alter table public.viewers add column user_id uuid references auth.users(id) on delete set null;
create index viewers_user_idx on public.viewers (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- Activity. Captured from the first viewer page onwards; displayed later.
-- ---------------------------------------------------------------------------
create type public.event_kind as enum ('view', 'play', 'comment', 'sync_save');

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  playlist_id      uuid not null references public.playlists(id) on delete cascade,
  track_id         uuid references public.tracks(id) on delete set null,
  viewer_id        uuid references public.viewers(id) on delete set null,
  kind             public.event_kind not null,
  duration_seconds numeric(10, 3),
  position_seconds numeric(10, 3),
  meta             jsonb,
  created_at       timestamptz not null default now()
);

create index events_playlist_idx on public.events (playlist_id, created_at desc);
create index events_track_idx on public.events (track_id) where track_id is not null;
create index events_viewer_idx on public.events (viewer_id) where viewer_id is not null;

-- Staff-side: which projects each person opened, and when. Drives the Recent
-- list and the "new submissions since you looked" dot.
create table public.staff_project_visits (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects_mirror(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index staff_project_visits_recent_idx on public.staff_project_visits (user_id, seen_at desc);

-- ---------------------------------------------------------------------------
-- Themes: presets, one per client brand, copied onto a playlist's theme.
-- ---------------------------------------------------------------------------
create table public.theme_presets (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  logo_url         text,
  background_url   text,
  background_color text,
  text_color       text,
  accent_color     text,
  font_family      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger theme_presets_touch before update on public.theme_presets
for each row execute function public.touch_updated_at();

alter table public.playlist_themes
  add column preset_id uuid references public.theme_presets(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Token resolution now respects the sign-in switch: an anonymous request can
-- only resolve a playlist that is an open link.
-- ---------------------------------------------------------------------------
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
    and (not p.require_sign_in or (select auth.uid()) is not null)
$$;

-- Viewer registration records the auth user when there is one.
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

  insert into public.viewers as v (playlist_id, name, email, user_id, user_agent)
  values (
    v_playlist,
    p_name,
    lower(trim(p_email)),
    (select auth.uid()),
    current_setting('request.headers', true)::json ->> 'user-agent'
  )
  on conflict (playlist_id, email) do update
    set name = excluded.name,
        user_id = coalesce(excluded.user_id, v.user_id),
        view_count = v.view_count + 1,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Token policies now apply to signed-in viewers as well as anon: a
-- viewer is `authenticated` but still presents the share token, and the
-- token is what scopes them to one playlist. Staff policies are unchanged in
-- shape; is_staff() itself is what changed.
-- ---------------------------------------------------------------------------
alter table public.playlist_sections    enable row level security;
alter table public.project_assets       enable row level security;
alter table public.viewer_profiles      enable row level security;
alter table public.events               enable row level security;
alter table public.staff_project_visits enable row level security;
alter table public.theme_presets        enable row level security;

-- Re-target the existing anon token policies at both roles.
drop policy token_read on public.projects_mirror;
create policy token_read on public.projects_mirror
  for select to anon, authenticated using (
    id = (select i.project_id from public.inboxes i where i.id = (select app.current_inbox_id()))
    or id = (select p.project_id from public.playlists p where p.id = (select app.current_playlist_id()))
  );

drop policy playlist_read on public.tracks;
create policy playlist_read on public.tracks
  for select to anon, authenticated using (
    exists (
      select 1 from public.playlist_tracks pt
      where pt.track_id = tracks.id
        and pt.playlist_id = (select app.current_playlist_id())
    )
    or id = (select p.video_track_id from public.playlists p where p.id = (select app.current_playlist_id()))
  );

drop policy token_read on public.playlists;
create policy token_read on public.playlists
  for select to anon, authenticated using (id = (select app.current_playlist_id()));

drop policy token_read on public.playlist_tracks;
create policy token_read on public.playlist_tracks
  for select to anon, authenticated using (playlist_id = (select app.current_playlist_id()));

drop policy token_read on public.playlist_themes;
create policy token_read on public.playlist_themes
  for select to anon, authenticated using (playlist_id = (select app.current_playlist_id()));

drop policy token_read on public.comments;
create policy token_read on public.comments
  for select to anon, authenticated using (playlist_id = (select app.current_playlist_id()));

drop policy token_insert on public.comments;
create policy token_insert on public.comments
  for insert to anon, authenticated with check (
    playlist_id = (select app.current_playlist_id())
    and viewer_id is not null
    and (select app.viewer_in_playlist(viewer_id, app.current_playlist_id()))
    and (
      target_id in (
        select pt.track_id from public.playlist_tracks pt
        where pt.playlist_id = (select app.current_playlist_id())
      )
      or target_id = (select p.video_track_id from public.playlists p where p.id = (select app.current_playlist_id()))
    )
  );

-- Sections
create policy staff_all on public.playlist_sections
  for all to authenticated using ((select app.is_staff())) with check ((select app.is_staff()));
create policy token_read on public.playlist_sections
  for select to anon, authenticated using (playlist_id = (select app.current_playlist_id()));

-- Assets: staff read; the webhook writes with service_role.
create policy staff_read on public.project_assets
  for select to authenticated using ((select app.is_staff()));

-- Profiles: a viewer manages their own; staff read all.
create policy own_profile on public.viewer_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy staff_read on public.viewer_profiles
  for select to authenticated using ((select app.is_staff()));

-- Events: anyone holding the token may record one against that playlist;
-- only staff read them back.
create policy staff_read on public.events
  for select to authenticated using ((select app.is_staff()));
create policy token_insert on public.events
  for insert to anon, authenticated with check (
    playlist_id = (select app.current_playlist_id())
    and (viewer_id is null or (select app.viewer_in_playlist(viewer_id, app.current_playlist_id())))
  );

-- Visits: each member of staff sees and writes only their own.
create policy own_visits on public.staff_project_visits
  for all to authenticated
  using (user_id = (select auth.uid()) and (select app.is_staff()))
  with check (user_id = (select auth.uid()) and (select app.is_staff()));

-- Presets: staff only. Viewers see the copy on playlist_themes.
create policy staff_all on public.theme_presets
  for all to authenticated using ((select app.is_staff())) with check ((select app.is_staff()));

-- Trigger functions are not published at /rest/v1/rpc/ (see 0002); nothing
-- new here is a trigger function, and register_viewer keeps its grants.
