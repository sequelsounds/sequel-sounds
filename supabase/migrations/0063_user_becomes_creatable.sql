-- Creating a person, not just editing one.
--
-- The app could edit a user and never make one. Five things were missing, and
-- the first is the one that would have wasted an afternoon:
--
--   1. `user` is block 31 of the hourly Xano push, and the mirror sync deletes
--      every row Xano did not send UNLESS the table carries `app_created`. A
--      user created here without that column is gone within the hour, silently.
--      This is the same pattern invoices, briefs, contracts and songs already
--      use; `user` simply never needed it before.
--   2. `id` had no default at all — no sequence, nothing.
--   3. `uuid` had no default either, and a user with no uuid is unreachable
--      from every edit page on both stacks. That is exactly how supplier 111
--      ended up stranded.
--   4. there was no insert policy. Read and update for staff, and nothing else.
--   5. the write guard is BEFORE UPDATE, so none of its normalising or its
--      follow-through into `track_users` applied to a new row.
--
-- ⚠️ THE TWO SIDES NOW DIVERGE FOR APP-CREATED USERS, and only for those. A
-- person created here exists in Supabase and never in Xano, so they can use
-- the new app and not the old one. Xano's own rows keep arriving and keep
-- winning, because they come in with app_created false.

alter table xano_mirror."user"
  add column if not exists app_created boolean not null default false;

comment on column xano_mirror."user".app_created is
  'True for a user this app created. The hourly Xano sync only deletes rows
   where this is false, so it is what keeps a new person alive past the hour.';

-- Xano's highest user id is 223. Starting at 10000 leaves the whole of Xano's
-- range clear, so an id allocated here can never collide with one Xano issues
-- later — the same reasoning as the supplier sequence starting at 1000.
create sequence if not exists xano_mirror.user_id_seq as bigint start with 10000 owned by xano_mirror."user".id;

select setval('xano_mirror.user_id_seq', greatest(10000, (select coalesce(max(id), 0) + 1 from xano_mirror."user" where id >= 10000)), false);

alter table xano_mirror."user"
  alter column id set default nextval('xano_mirror.user_id_seq'),
  alter column uuid set default gen_random_uuid();

drop policy if exists user_staff_insert on xano_mirror."user";
create policy user_staff_insert on xano_mirror."user"
  for insert to authenticated
  with check (public.track_is_staff());

create or replace function xano_mirror.user_create_guard()
returns trigger
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_type   text;
  v_status text;
begin
  -- The hourly sync writes as service_role with no end user attached and must
  -- pass through untouched, exactly as the update guard allows.
  if auth.uid() is null then
    return new;
  end if;

  new.app_created := true;
  new.created_at  := coalesce(new.created_at, now());
  new.updated_at  := now();
  new.updated_by  := public.track_user_id();

  -- Xano's unset integer FK is 0; Postgres' is null, and no lookup table has
  -- a row 0.
  new.company   := nullif(new.company, 0);
  new.user_type := nullif(new.user_type, 0);
  new.status    := nullif(new.status, 0);

  -- Nobody is created holding either access flag. They have no control on
  -- either stack and are raised deliberately or not at all.
  new.finance_user := false;
  new.management   := false;

  -- The login belongs to the database.
  new.login_code       := 0;
  new.code_expiry_time := null;

  -- ⚠️ WITHOUT THIS ROW THE PERSON CANNOT SIGN IN. `track_users` is the
  -- allowlist the app gates on; the directory entry alone does nothing. Both
  -- columns are NOT NULL there, so a user created without a type or a status
  -- gets the safe pair rather than a failed insert.
  select ut.user_type into v_type
    from xano_mirror.user_types ut where ut.id = new.user_type;
  select us.status into v_status
    from xano_mirror.user_statuses us where us.id = new.status;

  insert into public.track_users (id, email, full_name, user_type, status, company_client_id, job_title)
  values (
    new.id,
    new.email,
    new.name,
    coalesce(v_type, 'Supplier'),
    coalesce(v_status, 'Pending'),
    new.company,
    new.job_title
  )
  on conflict (id) do nothing;

  return new;
end
$function$;

drop trigger if exists user_create_guard on xano_mirror."user";
create trigger user_create_guard
  before insert on xano_mirror."user"
  for each row execute function xano_mirror.user_create_guard();

comment on function xano_mirror.user_create_guard is
  'Normalises a new user and gives them their track_users row, without which
   they cannot sign in. Skipped for the hourly sync, which has no auth.uid().';
