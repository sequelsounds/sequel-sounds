-- Editing a person now changes their ACCESS as well as the directory.
--
-- Andy's call, 14 Sep 2026. Before this, `/users/:uuid` had a Status dropdown
-- with "Blocked" in it that did not block anybody: every gate in the rebuild —
-- track_is_staff, track_is_finance, track_is_management, track_user_id — reads
-- public.track_users, a separate table with its own TEXT user_type and status
-- and nothing keeping the two in step.
--
-- They share an id space (checked: 149 of 149 rows match by id, and all 149
-- agreed on both columns at the moment this was applied), so the guard can
-- carry the change across by id.
--
-- ⚠️ CONSEQUENCE, deliberately accepted: setting someone to Blocked or
-- Archived on that page signs them out of the rebuild on their next request,
-- and moving someone to Sequel or Admin lets them in. A mistyped Status is now
-- a real access change rather than a cosmetic one.
--
-- ⚠️ SECURITY DEFINER, because `authenticated` has no grant on
-- public.track_users and should not have one — the only writes it can make are
-- the four below, on the row whose id the edited user already has.
--
-- ⚠️ ONE WAY ONLY. This carries an edit made in the rebuild across to
-- track_users. It does not carry a change made in Xano: the hourly sync writes
-- with no end user attached, the guard returns early, and track_users is left
-- alone. Someone blocked in Track is still let in here until the same edit is
-- made on this side. Settle that at cutover.

create or replace function xano_mirror.user_write_guard()
returns trigger
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $$
declare
  v_type   text;
  v_status text;
begin
  -- The hourly sync writes as service_role with no end user attached, and
  -- must pass through untouched.
  if auth.uid() is null then
    return new;
  end if;

  -- Identity and the login are the database's, not the caller's. The column
  -- grants already stop these arriving in an UPDATE; this is the second lock
  -- on the same door.
  new.id              := old.id;
  new.uuid            := old.uuid;
  new.email           := old.email;
  new.created_at      := old.created_at;
  new.phone_number    := old.phone_number;
  new.login_code      := old.login_code;
  new.code_expiry_time:= old.code_expiry_time;

  -- The two boolean access flags stay out of reach: neither has a control on
  -- either stack, and both have a counterpart on track_users that this does
  -- not attempt to move.
  new.finance_user    := old.finance_user;
  new.management      := old.management;

  -- Xano's unset integer FK is 0; Postgres' is null, and no lookup table has
  -- a row 0.
  new.company   := nullif(new.company, 0);
  new.user_type := nullif(new.user_type, 0);
  new.status    := nullif(new.status, 0);

  new.updated_at := now();
  new.updated_by := public.track_user_id();

  -- Carry the four fields that exist on both tables across, so the directory
  -- and the gate cannot disagree. Notes has no counterpart. A null type or
  -- status is left alone rather than written, because both are NOT NULL there.
  if new.user_type is distinct from old.user_type
     or new.status  is distinct from old.status
     or new.name    is distinct from old.name
     or new.company is distinct from old.company
  then
    select ut.user_type into v_type
      from xano_mirror.user_types ut where ut.id = new.user_type;
    select us.status into v_status
      from xano_mirror.user_statuses us where us.id = new.status;

    update public.track_users t
       set user_type         = coalesce(v_type, t.user_type),
           status            = coalesce(v_status, t.status),
           full_name         = new.name,
           company_client_id = new.company
     where t.id = new.id;
  end if;

  return new;
end
$$;

