-- 0084_release_form_notification_no_ref
--
-- Andy, 25 Sep 2026: no release form number in brackets on notifications —
-- "no-one cares until they open them". The message was
--   "Ogilvy Singapore opened the release form for Delete me (#4-R)."
-- and is now
--   "Ogilvy Singapore opened the release form for Delete me."
-- The project shows in the Notifications page's About column instead.

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
    format('%s %s the release form for %s.',
           coalesce(nullif(btrim(coalesce(v_form.recipient_name, '')), ''), 'Someone'),
           v_what,
           coalesce(nullif(btrim(coalesce(v_form.track_name, '')), ''), 'a track')),
    v_form.project_master_list_id,
    'release_form',
    v_form.uuid)
  on conflict do nothing;
end
$function$;

-- The ones already sent: drop the trailing " (#n-R)".
update public.track_notifications
   set message = regexp_replace(message, ' \(#[0-9]+-R\)\.$', '.')
 where subject_kind = 'release_form'
   and message ~ ' \(#[0-9]+-R\)\.$';
