-- 0075_notification_kinds
--
-- More things raise a notification (Andy, 23 Sep — "I like all of those"):
--
--   kind                 to                      when
--   invoice_submitted    finance                 an invoice request comes in
--   invoice_raised       project supervisor      status → Awaiting Payment
--   invoice_paid         project supervisor      status → Paid
--   invoice_overdue      supervisor + finance    Awaiting Payment past its due date
--   brief_submitted      project supervisor      a client submits a brief
--   studio_upload        project supervisor      a partner drop lands in an inbox
--   song_confirmed       project supervisor      a composer confirms song details
--   schedule_a_signed    project supervisor      a Schedule A is signed
--   access_requested     management              someone asks for access
--
-- Same rules as 0055: one named person, first time only per subject per kind,
-- the message written at the moment it happens. Plus two:
--
-- ⚠️ NEVER FOR YOUR OWN ACTION. If the signed-in person caused it, they are not
-- told about it. Changes arriving through the hourly Xano sync have no signed-in
-- person, so they notify as normal.
--
-- ⚠️ A NOTIFICATION MUST NEVER BREAK A SAVE OR THE SYNC. Every trigger swallows
-- its own errors with a warning.
--
-- ⚠️ INSERTS OLDER THAN TWO DAYS ARE IGNORED. The sync upserts; a restore or a
-- backfill would otherwise arrive as a flood of "new" rows.
--
-- Contracts are left out on purpose: they are uploaded already signed, so
-- there is no signing event to hang one on.

-- Where clicking goes, stored with the notification. Null falls back to the
-- front end's notificationHref (the 0055 release form rows).
alter table public.track_notifications add column if not exists link text;

-- ------------------------------------------------------------- helpers

create or replace function public.track_project_label(p_project bigint)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select nullif(trim(concat_ws(' ', p.sequel_no, p.title)), '')
    from xano_mirror.project_master_list p
   where p.id = p_project;
$$;

create or replace function public.track_project_supervisor(p_project bigint)
returns bigint
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select nullif(p.music_supervisor, 0)::bigint
    from xano_mirror.project_master_list p
   where p.id = p_project;
$$;

-- The one way in. p_refresh rewrites the message of an existing row instead of
-- ignoring the repeat (used by studio_upload, whose count grows as a drop lands).
create or replace function public.track_notify(
  p_user bigint, p_kind text, p_message text, p_project bigint,
  p_subject_kind text, p_subject uuid, p_link text, p_refresh boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if p_user is null or p_subject is null or p_message is null then
    return;
  end if;
  -- Live Sequel staff only.
  if not exists (select 1 from public.track_users u
                  where u.id = p_user
                    and u.user_type in ('Admin', 'Sequel')
                    and u.status not in ('Blocked', 'Archived')) then
    return;
  end if;
  -- Never for your own action.
  if p_user = public.track_user_id() then
    return;
  end if;
  if p_refresh then
    insert into public.track_notifications
      (user_id, kind, message, project_id, subject_kind, subject_uuid, link)
    values (p_user, p_kind, p_message, p_project, p_subject_kind, p_subject, p_link)
    on conflict (user_id, kind, subject_uuid) where subject_uuid is not null
    do update set message = excluded.message;
  else
    insert into public.track_notifications
      (user_id, kind, message, project_id, subject_kind, subject_uuid, link)
    values (p_user, p_kind, p_message, p_project, p_subject_kind, p_subject, p_link)
    on conflict (user_id, kind, subject_uuid) where subject_uuid is not null
    do nothing;
  end if;
end
$$;

revoke all on function public.track_project_label(bigint) from public, anon, authenticated;
revoke all on function public.track_project_supervisor(bigint) from public, anon, authenticated;
revoke all on function public.track_notify(bigint, text, text, bigint, text, uuid, text, boolean)
  from public, anon, authenticated;

-- ------------------------------------------------------------- invoices

create or replace function xano_mirror.invoices_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_project text := coalesce(public.track_project_label(new.project_master_list_id), 'a project');
  v_super   bigint := coalesce(nullif(new.music_supervisor_id, 0)::bigint,
                               public.track_project_supervisor(new.project_master_list_id));
  v_what    text := case when nullif(trim(new.invoice_number), '') is not null
                         then 'Invoice ' || trim(new.invoice_number) else 'The invoice' end;
  v_amount  text;
  v_link    text := '/invoices/' || new.uuid;
  v_fin     bigint;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'INSERT' and new.created_at < now() - interval '2 days' then
    return new;
  end if;

  if new.status = 'Submitted' then
    select left(c.currency, 3) || ' ' || to_char(new.total_to_invoice, 'FM999,999,990.00')
      into v_amount
      from xano_mirror.currencies_bank_accounts c where c.id = new.currency_id;
    for v_fin in select id from public.track_users where is_finance loop
      perform public.track_notify(v_fin, 'invoice_submitted',
        'Invoice request for ' || v_project
          || coalesce(' (' || v_amount || ')', '') || ' is ready to raise.',
        new.project_master_list_id, 'invoice', new.uuid, v_link);
    end loop;
  elsif new.status = 'Awaiting Payment' then
    perform public.track_notify(v_super, 'invoice_raised',
      v_what || ' for ' || v_project || ' has been raised.',
      new.project_master_list_id, 'invoice', new.uuid, v_link);
  elsif new.status = 'Paid' then
    perform public.track_notify(v_super, 'invoice_paid',
      v_what || ' for ' || v_project || ' has been paid.',
      new.project_master_list_id, 'invoice', new.uuid, v_link);
  end if;
  return new;
exception when others then
  raise warning 'invoice % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.invoices_notify() from public, anon, authenticated;

drop trigger if exists invoices_notify on xano_mirror.invoices;
create trigger invoices_notify
  after insert or update of status on xano_mirror.invoices
  for each row execute function xano_mirror.invoices_notify();

-- ------------------------------------------------------------- briefs

create or replace function xano_mirror.briefs_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_project text := coalesce(public.track_project_label(new.project_master_list_id), 'a project');
begin
  if new.status is distinct from 'Submitted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'Submitted' then
    return new;
  end if;
  -- An insert already Submitted is either an upload by staff (no notification)
  -- or a client's share-link brief that was requested and submitted between two
  -- syncs of the old app.
  if tg_op = 'INSERT' and (new.source is distinct from 'share_link'
                           or coalesce(new.submitted_at, new.created_at) < now() - interval '2 days') then
    return new;
  end if;
  perform public.track_notify(
    coalesce(public.track_project_supervisor(new.project_master_list_id), nullif(new.requested_by, 0)::bigint),
    'brief_submitted',
    case when nullif(trim(new.name), '') is not null
         then 'The brief "' || trim(new.name) || '" for ' || v_project || ' has been submitted.'
         else 'A brief for ' || v_project || ' has been submitted.' end,
    -- Old-app briefs can have no uuid; a stable one is made from the id so
    -- "first time only" still holds.
    new.project_master_list_id, 'brief', coalesce(new.uuid, md5('brief:' || new.id)::uuid),
    '/projects/' || new.project_master_list_id || '?tab=Briefs');
  return new;
exception when others then
  raise warning 'brief % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.briefs_notify() from public, anon, authenticated;

drop trigger if exists briefs_notify on xano_mirror.briefs;
create trigger briefs_notify
  after insert or update of status on xano_mirror.briefs
  for each row execute function xano_mirror.briefs_notify();

-- ------------------------------------------------------------- studio uploads

-- ONE PER DROP, not per track: the subject is the submission, and each track
-- that lands rewrites the count in the same row.
create or replace function public.tracks_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_xano  bigint;
  v_count int;
  v_who   text := coalesce(nullif(trim(new.submitter_company), ''), nullif(trim(new.submitter_name), ''), 'A partner');
begin
  select nullif(pm.xano_id, '')::bigint into v_xano
    from public.projects_mirror pm where pm.id = new.project_id;
  select count(*) into v_count from public.tracks t where t.submission_id = new.submission_id;
  perform public.track_notify(
    public.track_project_supervisor(v_xano), 'studio_upload',
    v_who || ' sent ' || v_count || ' track' || case when v_count = 1 then '' else 's' end
      || ' to the inbox for ' || coalesce(public.track_project_label(v_xano), 'a project') || '.',
    v_xano, 'submission', new.submission_id, '/studio/' || new.project_id, true);
  return new;
exception when others then
  raise warning 'track % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function public.tracks_notify() from public, anon, authenticated;

drop trigger if exists tracks_notify on public.tracks;
create trigger tracks_notify
  after insert on public.tracks
  for each row
  when (new.inbox_id is not null and new.submission_id is not null and new.project_id is not null)
  execute function public.tracks_notify();

-- ------------------------------------------------------------- songs

create or replace function xano_mirror.sequel_songs_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_project text := coalesce(public.track_project_label(new.project_master_list_id), 'a project');
  v_super   bigint := public.track_project_supervisor(new.project_master_list_id);
  v_title   text := coalesce(nullif(trim(new.track_title), ''), 'untitled');
  v_link    text := '/songs/' || new.uuid;
begin
  if old.confirmed_at is null and new.confirmed_at is not null then
    perform public.track_notify(v_super, 'song_confirmed',
      coalesce(nullif(trim(new.composer), ''), 'The composer')
        || ' confirmed the details for "' || v_title || '" (' || v_project || ').',
      new.project_master_list_id, 'song', new.uuid, v_link);
  end if;
  if old.schedule_a_signed_at is null and new.schedule_a_signed_at is not null then
    perform public.track_notify(v_super, 'schedule_a_signed',
      'The Schedule A for "' || v_title || '" (' || v_project || ') has been signed'
        || coalesce(' by ' || nullif(trim(new.schedule_a_signer_name), ''), '') || '.',
      new.project_master_list_id, 'song', new.uuid, v_link);
  end if;
  return new;
exception when others then
  raise warning 'song % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.sequel_songs_notify() from public, anon, authenticated;

drop trigger if exists sequel_songs_notify on xano_mirror.sequel_songs;
create trigger sequel_songs_notify
  after update of confirmed_at, schedule_a_signed_at on xano_mirror.sequel_songs
  for each row execute function xano_mirror.sequel_songs_notify();

-- ------------------------------------------------------------- access requests

-- A Pending user nobody signed in created: the old app's "request an invite"
-- form, arriving through the sync. A user made by staff (in the app or by Coda)
-- is somebody's own action and raises nothing.
create or replace function xano_mirror.user_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_mgmt    bigint;
  v_company text;
begin
  if public.track_user_id() is not null or coalesce(new.app_created, false) then
    return new;
  end if;
  if new.created_at < now() - interval '2 days' then
    return new;
  end if;
  select nullif(trim(c.company), '') into v_company from xano_mirror.clients c where c.id = new.company;
  for v_mgmt in select id from public.track_users where is_management loop
    perform public.track_notify(v_mgmt, 'access_requested',
      coalesce(nullif(trim(new.name), ''), nullif(trim(new.email), ''), 'Someone')
        || coalesce(' (' || v_company || ')', '') || ' has asked for access to the app.',
      null, 'user', new.uuid, '/users/' || new.uuid);
  end loop;
  return new;
exception when others then
  raise warning 'user % notification skipped: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.user_notify() from public, anon, authenticated;

drop trigger if exists user_notify on xano_mirror."user";
create trigger user_notify
  after insert on xano_mirror."user"
  for each row when (new.status = 2)
  execute function xano_mirror.user_notify();

-- ------------------------------------------------------------- reading, + overdue

-- ⚠️ OVERDUE IS RAISED HERE, WHEN SOMEONE LOOKS. Overdue is not a status, it is
-- a date passing, so no change fires a trigger — and there is no pg_cron. The
-- rail polls this every minute, so it is raised as soon as the person is in the
-- app, which is the only time they could see it anyway. Only invoices that fell
-- due in the last 7 days: the first run must not dump the whole back book.
-- VOLATILE now, since it writes.
create or replace function public.track_my_notifications(p_limit int default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_me bigint := public.track_user_id();
  v_fin boolean := public.track_is_finance();
  r record;
begin
  if v_me is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  for r in
    select i.uuid, i.invoice_number, i.project_master_list_id, i.due_date
      from xano_mirror.invoices i
     where i.status = 'Awaiting Payment'
       and i.due_date < current_date
       and i.due_date >= current_date - 7
       and (v_fin or coalesce(nullif(i.music_supervisor_id, 0)::bigint,
                              public.track_project_supervisor(i.project_master_list_id)) = v_me)
  loop
    insert into public.track_notifications
      (user_id, kind, message, project_id, subject_kind, subject_uuid, link)
    values (v_me, 'invoice_overdue',
      coalesce('Invoice ' || nullif(trim(r.invoice_number), ''), 'An invoice') || ' for '
        || coalesce(public.track_project_label(r.project_master_list_id), 'a project')
        || ' is overdue (due ' || to_char(r.due_date, 'FMDD Mon YYYY') || ').',
      r.project_master_list_id, 'invoice', r.uuid, '/invoices/' || r.uuid)
    on conflict (user_id, kind, subject_uuid) where subject_uuid is not null do nothing;
  end loop;

  return jsonb_build_object(
    'unread', (select count(*) from public.track_notifications n
                where n.user_id = v_me and n.read_at is null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (
          select n.id, n.kind, n.message, n.project_id, n.subject_kind,
                 n.subject_uuid, n.created_at, n.read_at, n.link,
                 p.sequel_no as project_sequel_no,
                 p.title     as project_title
            from public.track_notifications n
            left join xano_mirror.project_master_list p on p.id = n.project_id
           where n.user_id = v_me
           order by n.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 200))
        ) x), '[]'::jsonb));
end
$function$;
