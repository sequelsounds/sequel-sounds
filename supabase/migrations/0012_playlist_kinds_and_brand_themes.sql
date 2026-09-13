-- 0012 — playlist kinds, downloads, and themes that follow the brand.
--
-- A playlist link is not one thing. A client listening through a shortlist,
-- a director trying takes against the cut, and a composer's cuts being
-- marked up at timestamps are three pages with three sets of controls. The
-- kind says which one a link opens.

create type public.playlist_kind as enum ('standard', 'sync', 'composition');

alter table public.playlists
  add column kind            public.playlist_kind not null default 'standard',
  add column allow_download  boolean not null default true,
  add column allow_originals boolean not null default false;

comment on column public.playlists.kind is
  'What the viewer page is for. standard: listen and download. sync: the tracks are tried against the playlist''s film. composition: the films are the work, timestamped and commented on, and sign-in is required.';
comment on column public.playlists.allow_download is
  'Viewers may download the preview renders — the mp3, or the 720p mp4.';
comment on column public.playlists.allow_originals is
  'Viewers may download the files as delivered, uncompressed. Only meaningful with allow_download.';

-- A composition review is never an open link. The people on it are named
-- and their notes are attributed, which an anonymous visitor cannot be.
alter table public.playlists
  add constraint playlists_composition_requires_sign_in
  check (kind <> 'composition' or require_sign_in);

-- ---------------------------------------------------------------------------
-- Themes follow the brand. A preset names the brand it dresses, and a
-- playlist on a project of that brand wears it without anyone choosing —
-- unless the playlist has a theme of its own, which wins field by field.
-- ---------------------------------------------------------------------------
alter table public.theme_presets add column brand text;

create unique index theme_presets_brand_key
  on public.theme_presets (lower(brand)) where brand is not null;

comment on column public.theme_presets.brand is
  'Matched case-insensitively against the project''s brand as Track sends it (projects_mirror.raw->>''brand''). Null for a preset that is only ever picked by hand.';

-- ---------------------------------------------------------------------------
-- What a link holder may learn before the link resolves.
--
-- app.current_playlist_id() returns nothing for an anonymous request on a
-- sign-in link — deliberately, that is the whole protection — so the page
-- cannot tell "sign in first" from "this link is dead" by asking for the
-- playlist. This answers exactly that, and no more: the name to put on the
-- sign-in page, the kind, and whether a sign-in is wanted.
-- ---------------------------------------------------------------------------
create or replace function public.playlist_gate()
returns table (
  name            text,
  kind            public.playlist_kind,
  require_sign_in boolean,
  project_name    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, p.kind, p.require_sign_in, pm.name
  from public.playlists p
  left join public.projects_mirror pm on pm.id = p.project_id
  where p.token = app.request_token()
    and p.is_active
    and (p.expires_at is null or p.expires_at > now())
$$;

revoke all on function public.playlist_gate() from public;
grant execute on function public.playlist_gate() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The theme the viewer page wears, resolved server-side so the page never
-- needs to read presets or the project's raw record: the playlist's own
-- theme where it has one, else the preset for the project's brand, else
-- nothing — and the page falls back to Sequel's own colours. Field by field,
-- so a playlist can override one colour and keep the brand's logo.
-- ---------------------------------------------------------------------------
create or replace function public.effective_theme()
returns table (
  source           text,
  logo_url         text,
  background_url   text,
  background_color text,
  text_color       text,
  accent_color     text,
  heading          text
)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select pl.id, pm.raw->>'brand' as brand
    from public.playlists pl
    left join public.projects_mirror pm on pm.id = pl.project_id
    where pl.id = app.current_playlist_id()
  ),
  own as (
    select t.* from public.playlist_themes t, p where t.playlist_id = p.id
  ),
  preset as (
    select tp.* from public.theme_presets tp, p
    where p.brand is not null and lower(tp.brand) = lower(p.brand)
  )
  select
    case
      when exists (select 1 from own) then 'playlist'
      when exists (select 1 from preset) then 'brand'
      else 'default'
    end,
    coalesce(own.logo_url, preset.logo_url),
    coalesce(own.background_url, preset.background_url),
    coalesce(own.background_color, preset.background_color),
    coalesce(own.text_color, preset.text_color),
    coalesce(own.accent_color, preset.accent_color),
    own.heading
  from p
  left join own on true
  left join preset on true
$$;

revoke all on function public.effective_theme() from public;
grant execute on function public.effective_theme() to anon, authenticated;
