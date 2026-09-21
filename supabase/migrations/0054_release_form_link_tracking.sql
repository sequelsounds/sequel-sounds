-- 0054_release_form_link_tracking
--
-- The email that carries a release form stops carrying the PDF and carries a
-- LINK instead, and that link is tracked (Andy, 19 Sep).
--
-- ⚠️ IT IS A LINK *INSTEAD OF* AN ATTACHMENT, NOT AS WELL. Attach the PDF and
-- the recipient opens the attachment; the link is never touched and every
-- number here reads zero on a form that was read the day it arrived. The
-- tracking is only worth having if the link is the one way to the document.
--
-- ⚠️ A SENT LINK DOES NOT EXPIRE. The seven days on a share link is right for
-- sending a colleague something and wrong for a broadcaster, who files the
-- email and comes back to it months later. Archiving the form still kills the
-- link instantly, so the off switch is kept.

-- ------------------------------------------------------- links without an end
-- ⚠️ NULL means "no expiry" rather than a far-future date, so that
-- `expires_at <= now()` in resolve_share_link yields NULL and the expiry branch
-- simply does not fire. A year-2099 date would have worked until somebody read
-- it as a real date.
alter table public.share_links alter column expires_at drop not null;

comment on column public.share_links.expires_at is
  'NULL = never expires. Only sent release form links are minted this way; a SHARE link is always 7 days.';

-- ⚠️ ONE SENT LINK PER FORM, REUSED ON EVERY RESEND. A fresh code each time
-- would scatter one broadcaster's activity across several links and make
-- "have they read it?" unanswerable. `purpose` is what distinguishes it from
-- the 7-day links the share menu mints, which stay disposable.
alter table public.share_links
  add column if not exists purpose text not null default 'share';

create unique index if not exists share_links_sent_release_form_idx
  on public.share_links (release_form_uuid)
  where purpose = 'sent' and release_form_uuid is not null;

-- --------------------------------------------------------------- the events
-- Deliberately generic: assets and contracts share through the same page and
-- the same function, so when either wants this it is already recorded.
create table if not exists public.track_share_events (
  id         bigserial primary key,
  code       text not null,
  event      text not null check (event in ('view', 'download')),
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists track_share_events_code_idx
  on public.track_share_events (code, created_at desc);

alter table public.track_share_events enable row level security;
revoke all on public.track_share_events from anon, authenticated;

comment on table public.track_share_events is
  'Every open and download of a /link code. First-party: written server-side when the link resolves, not by a tracking pixel.';

-- ⚠️ SERVICE ROLE ONLY, and it never creates a row for a code that does not
-- exist — otherwise the table is a free write for anyone who can reach the
-- function. The rate limit that protects it is the one already inside
-- resolve_share_link, which sign-asset calls first.
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
end
$function$;

revoke all on function public.track_log_share_event(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.track_log_share_event(text, text, text, text) to service_role;

-- --------------------------------------------------- the link the email uses
-- Minted on the first send and handed back on every one after.
create or replace function public.track_release_form_send_link(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can send release forms.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.track_release_forms r
                  where r.uuid = p_uuid and r.status is distinct from 'Archived') then
    raise exception 'Release form not found.' using errcode = 'P0002';
  end if;

  select s.code into v_code
    from public.share_links s
   where s.release_form_uuid = p_uuid and s.purpose = 'sent';

  if v_code is null then
    v_code := public.share_code();
    insert into public.share_links (code, release_form_uuid, created_by, expires_at, purpose)
    values (v_code, p_uuid, public.track_user_id(), null, 'sent');
  end if;

  return jsonb_build_object('code', v_code);
end
$function$;

-- ------------------------------------------------------------- what happened
-- ⚠️ COUNTS AND TIMES, NOT A VISITOR LIST. It says the link was opened and
-- when, not who by: a forwarded link is a different person and nothing here can
-- tell the difference. Read it as "this reached someone", never as proof that
-- a named recipient read it.
create or replace function public.track_release_form_activity(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text;
  v_sent_at timestamptz;
  v_sent_to text;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select r.sent_at, r.sent_to into v_sent_at, v_sent_to
    from public.track_release_forms r where r.uuid = p_uuid;

  select s.code into v_code
    from public.share_links s
   where s.release_form_uuid = p_uuid and s.purpose = 'sent';

  return jsonb_build_object(
    'sent_at', v_sent_at,
    'sent_to', v_sent_to,
    'views', (select count(*) from public.track_share_events e
               where e.code = v_code and e.event = 'view'),
    'downloads', (select count(*) from public.track_share_events e
                   where e.code = v_code and e.event = 'download'),
    'last_view', (select max(e.created_at) from public.track_share_events e
                   where e.code = v_code and e.event = 'view'),
    'last_download', (select max(e.created_at) from public.track_share_events e
                       where e.code = v_code and e.event = 'download'));
end
$function$;
