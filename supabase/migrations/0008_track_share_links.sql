-- 0008 — a share link per track.
--
-- Staff sometimes need to send one track on its own, without building a
-- playlist for it. Same mechanism as every other share surface here: an
-- unguessable token in the `x-share-token` header, resolved in RLS.
--
-- The token is minted for every track up front rather than on demand. It is
-- 122 bits from the same generator as the others, it costs one text column,
-- and a link that already exists is one less write between a supe deciding to
-- send something and the link being on their clipboard.

alter table public.tracks
  add column share_token text not null default app.new_token();

create unique index tracks_share_token_idx on public.tracks (share_token);

comment on column public.tracks.share_token is
  'Per-track share link. Resolves one track and nothing around it — not its project, not its inbox, not the other tracks in either.';

-- Security definer, like the inbox and playlist resolvers, so the policy below
-- does not select from the very table it is filtering.
create or replace function app.current_track_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.tracks t
  where t.share_token = app.request_token()
$$;

grant execute on function app.current_track_id() to anon, authenticated;

-- Additive: a holder of a track token reads that one row. The existing
-- playlist_read and staff_all policies are untouched, and policies are OR'd,
-- so this widens nothing else.
create policy track_token_read on public.tracks
  for select to anon, authenticated using (id = (select app.current_track_id()));
