-- 16 Sep 2026. Briefs: the public /brief form and the staff side of the
-- project page's Briefs tab. Copies Xano's Briefs API group (request_brief,
-- get_brief_by_token, submit_brief, archive_brief) rule for rule.
--
-- ⚠️ `briefs` IS STILL IN THE HOURLY SYNC. A brief created here is deleted on
-- the next full push, the same as every other new-app test row (Andy agreed
-- the sync should delete them, 15 Sep). Build and test against the mirror,
-- cut over once, at the end — Andy's §1.5 call. Every brief in Xano today is
-- archived test data, so nothing real is at stake either way.
--
-- Upload brief is NOT here. It rides on the asset upload pipeline, which the
-- new app does not have yet and which comes with the shared file link (/link).

-- ------------------------------------------------------------ mirror traps 1+2
create sequence if not exists xano_mirror.briefs_id_seq as bigint start with 1000
  owned by xano_mirror.briefs.id;
select setval('xano_mirror.briefs_id_seq',
              greatest(1000, coalesce((select max(id) from xano_mirror.briefs), 0) + 1), false);
alter table xano_mirror.briefs
  alter column id set default nextval('xano_mirror.briefs_id_seq'),
  alter column uuid set default gen_random_uuid();

-- ------------------------------------------------------------- rate limiting
-- Xano's check_rate_limit, rebuilt: fixed window, one row per limit and caller.
-- No policies, so nothing reaches the table except the definer functions below.
create table if not exists public.rate_limits (
  limit_key    text primary key,
  hits         integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- The caller's address, off the headers PostgREST hands the database.
create or replace function public.request_ip()
returns text
language sql
stable
as $function$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip',
    btrim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)),
    'unknown'
  )
$function$;

-- True if the call may go ahead, and counts it. False once the limit is hit.
--
-- ⚠️ Returns rather than raises, and the callers do the same with their own
-- refusals: an exception rolls back the whole call, counter included, so a
-- raising caller would never count a failed attempt — and failed attempts are
-- exactly what a limit is for. Xano counts them because it has no rollback.
create or replace function public.check_rate_limit(p_limit text, p_max integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_key text := p_limit || '_' || public.request_ip();
  v_row public.rate_limits;
begin
  insert into public.rate_limits as r (limit_key, hits, window_start)
  values (v_key, 0, now())
  on conflict (limit_key) do nothing;

  select * into v_row from public.rate_limits where limit_key = v_key for update;

  if v_row.window_start + make_interval(secs => p_window_secs) < now() then
    update public.rate_limits set hits = 1, window_start = now() where limit_key = v_key;
    return true;
  end if;

  if v_row.hits >= p_max then
    return false;
  end if;

  update public.rate_limits set hits = hits + 1 where limit_key = v_key;
  return true;
end
$function$;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.request_ip() from public, anon, authenticated;

-- ------------------------------------------------------------------ the token
-- 32 characters, upper, lower and digits, like Xano's security.create_password.
-- Long because a brief link can sit in an inbox for weeks.
create or replace function public.brief_token()
returns text
language plpgsql
volatile
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
declare
  v_alpha constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_bytes bytea;
  v_out   text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(32);
    v_out := '';
    for i in 0..31 loop
      v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % 62) + 1, 1);
    end loop;
    exit when v_out ~ '[a-z]' and v_out ~ '[A-Z]' and v_out ~ '[0-9]';
  end loop;
  return v_out;
end
$function$;
revoke all on function public.brief_token() from public, anon, authenticated;

-- ------------------------------------------------------------ request_brief
-- Request brief (a link for the client) and Create brief (p_internal: a
-- supervisor fills the same form in). The row exists from the moment the link
-- is minted, so an unanswered brief shows on the tab and can be chased.
-- Link lives 30 days.
create or replace function public.track_request_brief(p_project_id bigint, p_internal boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_token text := public.brief_token();
  v_brief xano_mirror.briefs;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can request a brief.' using errcode = '42501';
  end if;
  if not exists (select 1 from xano_mirror.project_master_list p where p.id = p_project_id) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  insert into xano_mirror.briefs
    (project_master_list_id, share_token, share_expires_at, status, source, requested_by, created_at)
  values
    (p_project_id::integer, v_token, now() + interval '30 days', 'Requested',
     case when p_internal then 'internal' else 'share_link' end,
     public.track_user_id()::integer, now())
  returning * into v_brief;

  return jsonb_build_object(
    'brief_id', v_brief.id,
    'share_token', v_token,
    'expires_at', v_brief.share_expires_at
  );
end
$function$;
revoke all on function public.track_request_brief(bigint, boolean) from public, anon;
grant execute on function public.track_request_brief(bigint, boolean) to authenticated;

-- ------------------------------------------------------------ archive_brief
-- The row's ✕. Archives, never deletes, and kills the link at once so a
-- client holding it cannot submit to a brief staff removed.
create or replace function public.track_archive_brief(p_brief_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can remove a brief.' using errcode = '42501';
  end if;
  update xano_mirror.briefs b
     set status = 'Archived', share_expires_at = now()
   where b.id = p_brief_id;
  if not found then
    raise exception 'Brief not found.' using errcode = 'P0002';
  end if;
end
$function$;
revoke all on function public.track_archive_brief(bigint) from public, anon;
grant execute on function public.track_archive_brief(bigint) to authenticated;

-- --------------------------------------------------------------- public_brief
-- get_brief_by_token: what the form needs to open, for whoever holds the
-- token, and NOTHING else — the table carries budgets and internal notes.
-- Expiry and already-submitted are reported here, enforced in submit_brief.
-- 30 reads per caller per 5 minutes.
create or replace function public.public_brief(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_brief xano_mirror.briefs;
  v_project xano_mirror.project_master_list;
  v_agency text := '';
begin
  if not public.check_rate_limit('brief_read', 30, 300) then
    return jsonb_build_object('error', 'Too many requests. Please wait a few minutes and try again.');
  end if;
  -- An empty token must never match a blank share_token.
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('error', 'No brief found for this link.');
  end if;

  select * into v_brief from xano_mirror.briefs b where b.share_token = btrim(p_token) limit 1;
  if not found then
    return jsonb_build_object('error', 'No brief found for this link.');
  end if;

  select * into v_project from xano_mirror.project_master_list p where p.id = v_brief.project_master_list_id;
  if v_project.client_agency is not null then
    select coalesce(c.company, '') into v_agency from xano_mirror.clients c where c.id = v_project.client_agency;
  end if;

  return jsonb_build_object(
    'status', v_brief.status,
    'agency', coalesce(v_agency, ''),
    'brand', v_project.brand,
    'project_title', v_project.title,
    'expires_at', v_brief.share_expires_at,
    'submitted_at', v_brief.submitted_at
  );
end
$function$;
revoke all on function public.public_brief(text) from public;
grant execute on function public.public_brief(text) to anon, authenticated;

-- --------------------------------------------------------------- submit_brief
-- The client's answers. Unauthenticated, so the token is the whole check, and
-- the guards are Xano's, message for message:
--   unknown token, already submitted (single use), expired, blank name,
--   deadline sooner than the day after tomorrow (UTC, as Xano computes it).
-- Answers arrive keyed by the form's own question keys.
-- 10 attempts per caller per 10 minutes — above 5 because a client bounced by
-- the 48-hour rule retries.
create or replace function public.submit_brief(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_brief xano_mirror.briefs;
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_name text := nullif(btrim(a ->> 'name'), '');
  v_type text := nullif(btrim(a ->> 'brief_type'), '');
  v_vocal text := nullif(btrim(a ->> 'vocal_or_instrumental'), '');
  v_deadline_txt text := nullif(btrim(a ->> 'client_deadline'), '');
  v_deadline date;
begin
  if not public.check_rate_limit('brief_submit', 10, 600) then
    return jsonb_build_object('error', 'Too many requests. Please wait a few minutes and try again.');
  end if;
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('error', 'No brief found for this link.');
  end if;

  select * into v_brief from xano_mirror.briefs b where b.share_token = btrim(p_token) limit 1 for update;
  if not found then
    return jsonb_build_object('error', 'No brief found for this link.');
  end if;
  if v_brief.submitted_at is not null then
    return jsonb_build_object('error', 'This brief has already been submitted.');
  end if;
  if v_brief.share_expires_at is not null and v_brief.share_expires_at <= now() then
    return jsonb_build_object('error', 'This link has expired. Please ask your Sequel contact for a new one.');
  end if;
  if v_name is null then
    return jsonb_build_object('error', 'Please give the brief a name.');
  end if;
  -- Xano's two enums. The form only ever sends these.
  if v_type is not null and v_type not in ('Library', 'Composition', 'Commercial') then
    return jsonb_build_object('error', 'That didn''t send. Please try again.');
  end if;
  if v_vocal is not null and v_vocal not in ('Vocal', 'Instrumental', 'Either') then
    return jsonb_build_object('error', 'That didn''t send. Please try again.');
  end if;
  if v_deadline_txt is not null then
    begin
      v_deadline := v_deadline_txt::date;
    exception when others then
      return jsonb_build_object('error', 'We need at least 48 hours. Please choose a date from the day after tomorrow onwards.');
    end;
    if v_deadline < ((now() at time zone 'UTC') + interval '48 hours')::date then
      return jsonb_build_object('error', 'We need at least 48 hours. Please choose a date from the day after tomorrow onwards.');
    end if;
  end if;

  update xano_mirror.briefs b set
    brief_type            = v_type,
    client_budget_note    = nullif(btrim(a ->> 'budget_note'), ''),
    name                  = v_name,
    one_sentence_brief    = nullif(btrim(a ->> 'one_sentence'), ''),
    idea_inspo            = nullif(btrim(a ->> 'inspo'), ''),
    styles_and_genres     = nullif(btrim(a ->> 'genres'), ''),
    target_audience       = nullif(btrim(a ->> 'audience'), ''),
    audience_to_feel      = nullif(btrim(a ->> 'feel'), ''),
    geography_or_time     = nullif(btrim(a ->> 'geography'), ''),
    off_limits            = nullif(btrim(a ->> 'off_limits'), ''),
    story_or_accents      = nullif(btrim(a ->> 'story'), ''),
    reference_tracks      = nullif(btrim(a ->> 'reference_tracks'), ''),
    ref_comments          = nullif(btrim(a ->> 'ref_comments'), ''),
    vocal_or_instrumental = v_vocal,
    lyrical_themes        = nullif(btrim(a ->> 'lyrical_themes'), ''),
    client_deadline       = v_deadline,
    anything_else         = nullif(btrim(a ->> 'anything_else'), ''),
    status                = 'Submitted',
    submitted_at          = now()
  where b.id = v_brief.id;

  return jsonb_build_object('success', true);
end
$function$;
revoke all on function public.submit_brief(text, jsonb) from public;
grant execute on function public.submit_brief(text, jsonb) to anon, authenticated;

-- -------------------------------------------------------------- project_briefs
-- The tab needs the live token (for the row's share icon) and its expiry.
-- Handed out under the same guard as Xano's get_project_briefs: only while
-- the link would still work, so a dead token is never offered.
-- ⚠️ Appended at the end — `create or replace view` cannot reorder.
create or replace view xano_mirror.project_briefs
with (security_invoker = true) as
select b.id,
    b.project_master_list_id,
    b.name,
    b.brief_type,
    b.status,
    b.source,
    b.one_sentence_brief,
    b.vocal_or_instrumental,
    b.client_deadline,
    b.sequel_deadline,
    b.submitted_at,
    u.name as requested_by,
    ((nullif(btrim(b.share_token), '') is not null) and ((b.share_expires_at is null) or (b.share_expires_at > now()))) as share_link_live,
    b.created_at,
    case
      when nullif(btrim(b.share_token), '') is not null
       and b.submitted_at is null
       and (b.share_expires_at is null or b.share_expires_at > now())
      then b.share_token
    end as share_token,
    b.share_expires_at
   from xano_mirror.briefs b
     left join xano_mirror."user" u on u.id = b.requested_by;
