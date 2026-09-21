-- 0055_notifications
--
-- In-app notifications, and the first thing to raise one: a release form link
-- being opened or downloaded (Andy, 19 Sep — "I feel like this should be a
-- notification").
--
-- ⚠️ NOT xano_mirror.notifications. That table exists, has six rows from August
-- and even has the right vocabulary (schedule_a_viewed, schedule_a_signed), but
-- the Xano sync OVERWRITES THE WHOLE MIRROR HOURLY. Anything the app writes
-- there is gone within the hour. App-owned data lives in public.
--
-- ⚠️ FIRST TIME ONLY, per form per kind — Andy, 19 Sep. A broadcaster who
-- refreshes twice and forwards the link to two colleagues would otherwise
-- generate five notifications for one clearance, and a feed that cries wolf
-- gets ignored, which is worse than not having one. The running counts stay in
-- the share menu, where they belong.

create table if not exists public.track_notifications (
  id           bigserial primary key,
  -- Who it is for. One row per person: a notification read by one Sequel user
  -- is not read by another.
  user_id      bigint not null,
  -- 'release_form_viewed' | 'release_form_downloaded'. Free text on purpose —
  -- the old Xano set used the same shape and new kinds should not need DDL.
  kind         text not null,
  -- Written at the moment it happens, not rendered at read time. The form can
  -- be edited or archived afterwards and the notification should still say what
  -- it said.
  message      text not null,
  -- Where clicking it should go, when there is somewhere. Nullable: not every
  -- notification will have a page.
  project_id   bigint,
  subject_kind text,
  subject_uuid uuid,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists track_notifications_user_idx
  on public.track_notifications (user_id, created_at desc);

-- ⚠️ THIS IS WHAT MAKES "FIRST TIME ONLY" TRUE. Without it, two opens landing
-- in the same second both pass an existence check and both insert.
create unique index if not exists track_notifications_once_idx
  on public.track_notifications (user_id, kind, subject_uuid)
  where subject_uuid is not null;

alter table public.track_notifications enable row level security;
revoke all on public.track_notifications from anon, authenticated;

comment on table public.track_notifications is
  'In-app notifications for Sequel staff. App-owned: NOT the mirrored xano_mirror.notifications, which the hourly sync overwrites.';

-- --------------------------------------------------------------- reading
create or replace function public.track_my_notifications(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_me bigint := public.track_user_id();
begin
  if v_me is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.track_notifications n
                where n.user_id = v_me and n.read_at is null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (
          select n.id, n.kind, n.message, n.project_id, n.subject_kind,
                 n.subject_uuid, n.created_at, n.read_at
            from public.track_notifications n
           where n.user_id = v_me
           order by n.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 200))
        ) x), '[]'::jsonb));
end
$function$;

-- ⚠️ NULL p_ids marks EVERYTHING read. The caller can only ever affect its own
-- rows: user_id is taken from the session, never from the argument.
create or replace function public.track_mark_notifications_read(p_ids bigint[] default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_me bigint := public.track_user_id();
begin
  if v_me is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.track_notifications
     set read_at = now()
   where user_id = v_me
     and read_at is null
     and (p_ids is null or id = any(p_ids));
end
$function$;

-- --------------------------------------------------- raising one on a share
-- ⚠️ IT NOTIFIES WHOEVER SENT THE FORM, not every member of staff. That is
-- share_links.created_by on the 'sent' link — the person who pressed send, and
-- the person the reply would come back to. If that is null (an older link) no
-- notification is raised, because a notification for nobody in particular is
-- one everybody learns to skip.
create or replace function public.track_notify_share_event(p_code text, p_event text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_link    public.share_links;
  v_form    public.track_release_forms;
  v_kind    text;
  v_what    text;
begin
  select * into v_link from public.share_links s where s.code = p_code;
  if not found or v_link.created_by is null or v_link.release_form_uuid is null then
    return;
  end if;
  -- Only the link that was emailed. A 7-day link copied to a colleague is not
  -- a broadcaster opening a release form.
  if v_link.purpose is distinct from 'sent' then
    return;
  end if;

  select * into v_form from public.track_release_forms r where r.uuid = v_link.release_form_uuid;
  if not found then
    return;
  end if;

  v_kind := case when p_event = 'download' then 'release_form_downloaded'
                 else 'release_form_viewed' end;
  v_what := case when p_event = 'download' then 'downloaded' else 'opened' end;

  insert into public.track_notifications
    (user_id, kind, message, project_id, subject_kind, subject_uuid)
  values (
    v_link.created_by,
    v_kind,
    format('%s %s the release form for %s (%s).',
           coalesce(nullif(btrim(coalesce(v_form.recipient_name, '')), ''), 'Someone'),
           v_what,
           coalesce(nullif(btrim(coalesce(v_form.track_name, '')), ''), 'a track'),
           public.track_ref('release', v_form.id)),
    v_form.project_master_list_id,
    'release_form',
    v_form.uuid)
  -- The index is what enforces once-only; this is how it stays quiet about it.
  on conflict do nothing;
end
$function$;

-- ⚠️ track_log_share_event now RAISES THE NOTIFICATION TOO, so that recording
-- an open and telling somebody about it cannot drift apart. Same guards as
-- before: unknown event and unknown code both return without writing.
create or replace function public.track_log_share_event(
  p_code text, p_event text, p_ip text, p_agent text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if p_event not in ('view', 'download') then
    return;
  end if;
  if not exists (select 1 from public.share_links s where s.code = btrim(coalesce(p_code, ''))) then
    return;
  end if;
  insert into public.track_share_events (code, event, ip, user_agent)
  values (btrim(p_code), p_event, nullif(btrim(coalesce(p_ip, '')), ''),
          left(nullif(btrim(coalesce(p_agent, '')), ''), 400));

  perform public.track_notify_share_event(btrim(p_code), p_event);
end
$function$;

revoke all on function public.track_log_share_event(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.track_log_share_event(text, text, text, text) to service_role;
revoke all on function public.track_notify_share_event(text, text)
  from public, anon, authenticated;
grant execute on function public.track_notify_share_event(text, text) to service_role;
