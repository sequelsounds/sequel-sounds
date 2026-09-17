-- Email the music supervisor when a brief is submitted — the new app's copy of
-- Xano table trigger 15, added to the old app on 17 Sep 2026.
--
-- The trigger only queues a POST to the brief-submitted edge function through
-- pg_net, which sends after the transaction commits: nothing here can fail or
-- slow down a client's submission. The function does the rest (recipient,
-- wording, Resend) and claims the brief so it is emailed once.
--
-- ⚠️ Skipped when the update comes from the hourly Xano sync (service_role):
-- a brief submitted in the OLD app is emailed by Xano's own trigger, and the
-- sync copying it across must not send a second one.
-- Update only, as in Xano: uploaded briefs are inserted already Submitted and
-- never email.

create extension if not exists pg_net;

alter table xano_mirror.briefs add column if not exists supervisor_emailed_at timestamptz;
alter table xano_mirror.briefs add column if not exists supervisor_email_error text;

create or replace function xano_mirror.briefs_email_supervisor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  perform net.http_post(
    url     := 'https://sveirphsppyfhulymjiu.supabase.co/functions/v1/brief-submitted',
    body    := jsonb_build_object('brief_id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- Never let the email get in the way of the save.
  raise warning 'brief % email not queued: %', new.id, sqlerrm;
  return new;
end
$$;
revoke all on function xano_mirror.briefs_email_supervisor() from public, anon, authenticated;

drop trigger if exists briefs_email_supervisor on xano_mirror.briefs;
create trigger briefs_email_supervisor
  after update of status on xano_mirror.briefs
  for each row
  when (new.status = 'Submitted' and old.status is distinct from 'Submitted')
  execute function xano_mirror.briefs_email_supervisor();
