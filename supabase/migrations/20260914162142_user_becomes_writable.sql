-- Users become editable: the five fields Track's /view-user edits, and nothing
-- else. Xano's user_edit (413) is staff-only (user_type 1 or 2) and accepts
-- Name, Company, user_type, status and Notes; that is the set reproduced here.
--
-- email is NOT editable on either stack: it is the login. phone_number and
-- login_code are the login ID and the one-time passcode. finance_user and
-- management are access flags no page has ever offered.

alter table xano_mirror."user"
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by bigint;

comment on column xano_mirror."user".updated_by is
  'public.track_users.id of whoever last edited this row from the rebuild.';

-- Layer 1: column grants. The security boundary — id, uuid, email and the
-- login columns cannot be moved however the request is built.
grant update (name, company, user_type, status, notes)
  on xano_mirror."user" to authenticated;

-- Layer 2: RLS. The same question the read policy asks.
create policy user_staff_update on xano_mirror."user"
  for update to authenticated
  using (public.track_is_staff())
  with check (public.track_is_staff());

-- Layer 3: the guard, for what RLS cannot say — which COLUMNS changed, and
-- Xano's zero-means-null on the three integer foreign keys.
create or replace function xano_mirror.user_write_guard()
returns trigger
language plpgsql
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $$
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

  -- Access flags. Neither is connected to public.track_users, which is what
  -- actually decides what a person can see here, so letting a form move them
  -- would look like granting access and do nothing.
  new.finance_user    := old.finance_user;
  new.management      := old.management;

  -- Xano's unset integer FK is 0; Postgres' is null, and no lookup table has
  -- a row 0.
  new.company   := nullif(new.company, 0);
  new.user_type := nullif(new.user_type, 0);
  new.status    := nullif(new.status, 0);

  new.updated_at := now();
  new.updated_by := public.track_user_id();

  return new;
end
$$;

create trigger user_write_guard
  before update on xano_mirror."user"
  for each row execute function xano_mirror.user_write_guard();

