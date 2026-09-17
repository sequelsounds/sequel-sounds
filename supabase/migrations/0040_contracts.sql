-- Contracts written by the new app — 17 Sep 2026.
--
-- A rebuild of Xano's Contracts group (api 526/528/530/551/552/565/566 and
-- function 46) on the shape the assets rebuild established in 0028: the row is
-- written before the file, the database decides who may do what, and the Edge
-- Function only signs keys these functions hand it.
--
-- Read `sequel-track-contracts.md` before changing any rule here. The ones that
-- cost someone a day are marked.
--
-- Differences from Xano, all deliberate:
--  * Files go to the new app's bucket, sequel-sounds-media, under
--    contracts/{uuid}_{filename} — the same shape as project-assets, so the 27
--    files in contract-hub can be synced across at cutover with their paths
--    intact (Andy, 17 Sep).
--  * `delete_contract` is called what it does: track_archive_contract.
--  * Renewals are a view in the app, not an email (Andy, 17 Sep). Nothing here
--    sends anything to anyone.

-- ---------------------------------------------------------- mirror traps 1+2
-- id and uuid have no default in the mirror; an insert without both fails.
create sequence if not exists xano_mirror.contracts_id_seq as bigint start with 1000
  owned by xano_mirror.contracts.id;
select setval('xano_mirror.contracts_id_seq',
              greatest(1000, coalesce((select max(id) from xano_mirror.contracts), 0) + 1), false);
alter table xano_mirror.contracts
  alter column id set default nextval('xano_mirror.contracts_id_seq'),
  alter column uuid set default gen_random_uuid();

-- ⚠️ Contracts is in the hourly Xano sync, which deletes what Xano did not
-- send. `app_created` is what the sync spares (see xano-mirror-sync), and the
-- trigger sets it whenever a signed-in user is the one writing — the service
-- role, which is what the sync uses, has no auth.uid().
alter table xano_mirror.contracts
  add column if not exists app_created boolean not null default false;
drop trigger if exists contracts_mark_app_created on xano_mirror.contracts;
create trigger contracts_mark_app_created
  before insert on xano_mirror.contracts
  for each row execute function xano_mirror.mark_app_created();

-- --------------------------------------------------------- the date engine
-- compute_contract_dates (function 46), the single source of truth for every
-- contract date. Called by save and by the extraction's suggestions — never
-- duplicated, because the month-end rule is too easy to get subtly wrong.
--
-- ⚠️ A PRINTED END DATE ALWAYS BEATS A DERIVED ONE.
-- ⚠️ Perpetual gets no expiry and no notify date at all. Chasing a renewal on
--    a licence the client already owns outright is the expensive mistake.
-- Postgres month arithmetic clamps (2026-01-31 + 1 month = 2026-02-28), which
-- is the behaviour Xano had to be taught by hand. Units are lowercased and
-- de-pluralised because "month" silently returned nothing in Xano and looked
-- exactly like a perpetual licence.
create or replace function public.track_contract_dates(
  p_start date, p_end date, p_term_value int, p_term_unit text, p_perpetual boolean)
returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare
  v_unit text := rtrim(lower(btrim(coalesce(p_term_unit, ''))), 's');
  v_end  date := p_end;
begin
  if coalesce(p_perpetual, false) then
    return jsonb_build_object('end_date', null, 'renewal_notify_at', null);
  end if;

  if v_end is null and p_start is not null and coalesce(p_term_value, 0) > 0 then
    v_end := case v_unit
               when 'day'   then p_start + (p_term_value || ' days')::interval
               when 'week'  then p_start + (p_term_value || ' weeks')::interval
               when 'month' then p_start + (p_term_value || ' months')::interval
               when 'year'  then p_start + (p_term_value || ' years')::interval
               else null
             end;
  end if;

  if v_end is null then
    return jsonb_build_object('end_date', null, 'renewal_notify_at', null);
  end if;

  -- 42 days before expiry, floored at the start date so a three-week pop-up
  -- cannot alert before it was signed.
  return jsonb_build_object(
    'end_date', v_end,
    'renewal_notify_at', greatest(coalesce(p_start, v_end - 42), v_end - 42));
end
$function$;

-- ------------------------------------------------------------------ upload
-- The row BEFORE the file, as with assets: an object with no row would be
-- invisible for ever, because nothing scans the bucket.
create or replace function public.track_create_contract(
  p_project_id bigint, p_file_name text, p_file_size text, p_file_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_uuid uuid := gen_random_uuid();
  v_name text := nullif(btrim(replace(replace(coalesce(p_file_name, ''), '/', '_'), '\', '_')), '');
  v_key text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can upload contracts.' using errcode = '42501';
  end if;
  if not exists (select 1 from xano_mirror.project_master_list p where p.id = p_project_id) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  v_key := 'contracts/' || v_uuid || '_' || coalesce(v_name, v_uuid::text);

  insert into xano_mirror.contracts
    (uuid, project_master_list_id, file_name, file_size, file_type,
     aws_path, url, confirmed, status, created_at)
  values
    (v_uuid, p_project_id::integer, coalesce(v_name, v_uuid::text),
     coalesce(nullif(btrim(p_file_size), ''), ''), coalesce(nullif(btrim(p_file_type), ''), ''),
     v_key, v_key, false, 'Active', now());

  return jsonb_build_object('uuid', v_uuid, 'key', v_key);
end
$function$;

-- ------------------------------------------------------------------- save
-- confirm_contract_upload (528) and update_contract (565) in one function,
-- told apart by whether the row is already confirmed.
--
-- ⚠️ uploaded_by is stamped ONCE, on the confirm. An edit that rewrote it
--    would put whoever last fixed a date in the uploader's place.
-- ⚠️ renewal_notified_at is cleared when the expiry moves, or a contract whose
--    dates are corrected stays marked as chased and never alerts again.
-- ⚠️ Percentages are text in, so an empty box stores null ("does not apply")
--    rather than 0 ("a stated zero").
create or replace function public.track_save_contract(
  p_uuid uuid,
  p_contract_type int,
  p_supplier_id int,
  p_description text,
  p_artist text,
  p_song_name text,
  p_notes text,
  p_master_pct text,
  p_publishing_pct text,
  p_mcps_yn boolean,
  p_start_date date,
  p_end_date date,
  p_term_value int,
  p_term_unit text,
  p_perpetual boolean,
  p_supplier_address text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_row       xano_mirror.contracts;
  v_type      text;
  v_perpetual boolean := coalesce(p_perpetual, false);
  v_unit      text := nullif(btrim(lower(coalesce(p_term_unit, ''))), '');
  v_master    numeric := nullif(btrim(coalesce(p_master_pct, '')), '')::numeric;
  v_pub       numeric := nullif(btrim(coalesce(p_publishing_pct, '')), '')::numeric;
  v_dates     jsonb;
  v_end       date;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can save contracts.' using errcode = '42501';
  end if;

  select * into v_row from xano_mirror.contracts c where c.uuid = p_uuid;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;

  if p_contract_type is null then
    raise exception 'Pick a contract type.' using errcode = '22023';
  end if;
  select t.type into v_type from xano_mirror.contract_types t where t.id = p_contract_type;
  if v_type is null then
    raise exception 'That is not a contract type.' using errcode = '22023';
  end if;
  if p_supplier_id is null then
    raise exception 'Pick the supplier.' using errcode = '22023';
  end if;
  if not exists (select 1 from xano_mirror.supplier_list s where s.id = p_supplier_id) then
    raise exception 'That supplier is not on the list.' using errcode = '22023';
  end if;
  -- A term with no unit computes no expiry, and the contract then drops out of
  -- renewal chasing without anything looking wrong. Blocked at the gate.
  if coalesce(p_term_value, 0) > 0 and v_unit is null and not v_perpetual then
    raise exception 'Say whether the term is in days, weeks, months or years.' using errcode = '22023';
  end if;

  -- A Buy Out is perpetual whatever the prose says.
  if v_type = 'Buy Out' then
    v_perpetual := true;
  end if;
  -- Library and Sonic Branding grant the lot; Master and Publishing carry only
  -- their own side. Talent grants no share at all.
  if v_type in ('Library', 'Sonic Branding') then
    v_master := 100; v_pub := 100;
  elsif v_type = 'Master' then
    v_pub := null;
  elsif v_type = 'Publishing' then
    v_master := null;
  elsif v_type = 'Talent' then
    v_master := null; v_pub := null;
  end if;

  v_dates := public.track_contract_dates(p_start_date, p_end_date, p_term_value, v_unit, v_perpetual);
  v_end := (v_dates ->> 'end_date')::date;

  update xano_mirror.contracts c
     set contract_type    = p_contract_type,
         supplier_list_id = p_supplier_id,
         description      = nullif(btrim(coalesce(p_description, '')), ''),
         artist           = nullif(btrim(coalesce(p_artist, '')), ''),
         song_name        = nullif(btrim(coalesce(p_song_name, '')), ''),
         notes            = nullif(btrim(coalesce(p_notes, '')), ''),
         master_pct       = v_master,
         publishing_pct   = v_pub,
         mcps_yn          = coalesce(p_mcps_yn, false),
         start_date       = p_start_date,
         end_date         = v_end,
         term_value       = nullif(coalesce(p_term_value, 0), 0),
         term_unit        = v_unit,
         perpetual        = v_perpetual,
         supplier_address = nullif(btrim(coalesce(p_supplier_address, '')), ''),
         renewal_notify_at = (v_dates ->> 'renewal_notify_at')::date,
         -- Moved expiry, so it is due to be looked at again.
         renewal_notified_at = case when v_end is distinct from v_row.end_date
                                    then null else c.renewal_notified_at end,
         uploaded_by      = case when coalesce(v_row.confirmed, false)
                                 then c.uploaded_by
                                 else public.track_user_id()::integer end,
         confirmed        = true,
         status           = coalesce(nullif(c.status, ''), 'Active')
   where c.uuid = p_uuid;

  return jsonb_build_object('uuid', p_uuid, 'end_date', v_end,
                            'renewal_notify_at', v_dates -> 'renewal_notify_at',
                            'perpetual', v_perpetual);
end
$function$;

-- ------------------------------------------------------------ file access
create or replace function public.track_contract_key(p_uuid uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_key text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can open this contract.' using errcode = '42501';
  end if;
  select c.aws_path into v_key from xano_mirror.contracts c where c.uuid = p_uuid;
  if coalesce(v_key, '') = '' then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  return v_key;
end
$function$;

-- --------------------------------------------------------------- archive
-- ⚠️ ARCHIVES, NEVER DELETES. A contract is the evidence Sequel had the right
-- to use the music; the whole shelf is about 100MB. The share link is retired
-- with it, because an archived contract should stop being reachable by link.
create or replace function public.track_archive_contract(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can archive contracts.' using errcode = '42501';
  end if;
  delete from public.share_links s where s.contract_uuid = p_uuid;
  update xano_mirror.contracts c set status = 'Archived' where c.uuid = p_uuid;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
end
$function$;

-- An unconfirmed upload that was abandoned — the modal closing before save.
-- This one really does delete, exactly as the assets modal does.
create or replace function public.track_discard_contract(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can discard contracts.' using errcode = '42501';
  end if;
  delete from xano_mirror.contracts c where c.uuid = p_uuid and not coalesce(c.confirmed, false);
  if not found then
    raise exception 'That contract is saved — archive it instead.' using errcode = '42501';
  end if;
end
$function$;

-- ----------------------------------------------------------------- share
alter table public.share_links
  add column if not exists contract_uuid uuid;
alter table public.share_links
  alter column asset_uuid drop not null;
create index if not exists share_links_contract_uuid_idx on public.share_links (contract_uuid);
alter table public.share_links drop constraint if exists share_links_one_target;
alter table public.share_links add constraint share_links_one_target
  check (num_nonnulls(asset_uuid, contract_uuid) = 1);

create or replace function public.track_share_contract(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_code text := public.share_code();
  v_expires timestamptz := now() + interval '7 days';
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can share contracts.' using errcode = '42501';
  end if;
  if not exists (select 1 from xano_mirror.contracts c
                  where c.uuid = p_uuid and c.confirmed
                    and c.status is distinct from 'Archived') then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  insert into public.share_links (code, contract_uuid, created_by, expires_at)
  values (v_code, p_uuid, public.track_user_id(), v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$function$;

-- --------------------------------------------------------------- renewals
-- The view that replaces the email nobody has written: what is about to lapse,
-- and what cannot be chased because its dates never resolved.
--
-- ⚠️ `renewal_notify_at <= today`, never `= today`. Equality silently skips
-- anything papered after commencement, everything in a backfill, and any day
-- the page is not opened.
create or replace function public.track_contract_renewals()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_due jsonb;
  v_unresolved jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can see renewals.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.end_date, r.id), '[]'::jsonb) into v_due
  from (
    select c.id, c.uuid, c.file_name, c.end_date, c.start_date,
           (c.end_date - current_date) as days_left,
           c.renewal_notified_at is not null as seen,
           t.type as contract_type, s.title as supplier,
           p.id as project_id, p.sequel_no, p.title as project_title, p.brand,
           c.artist, c.song_name
      from xano_mirror.contracts c
      left join xano_mirror.contract_types t on t.id = c.contract_type
      left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
      left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
     where c.confirmed
       and c.status is distinct from 'Archived'
       and not coalesce(c.perpetual, false)
       and c.end_date is not null
       and c.renewal_notify_at is not null
       and c.renewal_notify_at <= current_date
       and c.end_date >= current_date
  ) r;

  -- The failure bucket. Without it an extraction miss is invisible, and that
  -- is the direction that loses money quietly.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_unresolved
  from (
    select c.id, c.uuid, c.file_name, c.created_at,
           t.type as contract_type, s.title as supplier,
           p.id as project_id, p.sequel_no, p.title as project_title, p.brand
      from xano_mirror.contracts c
      left join xano_mirror.contract_types t on t.id = c.contract_type
      left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
      left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
     where c.confirmed
       and c.status is distinct from 'Archived'
       and not coalesce(c.perpetual, false)
       and c.end_date is null
  ) r;

  return jsonb_build_object('due', v_due, 'unresolved', v_unresolved,
                            'expired', (select count(*) from xano_mirror.contracts c
                                         where c.confirmed and c.status is distinct from 'Archived'
                                           and not coalesce(c.perpetual, false)
                                           and c.end_date is not null and c.end_date < current_date));
end
$function$;

-- Stamped when someone has dealt with a renewal, so it drops off the list.
create or replace function public.track_mark_renewal_seen(p_uuid uuid, p_seen boolean)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can do that.' using errcode = '42501';
  end if;
  update xano_mirror.contracts c
     set renewal_notified_at = case when coalesce(p_seen, true) then now() else null end
   where c.uuid = p_uuid;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
end
$function$;

-- ------------------------------------------------------------------ views
-- The tab's list: confirmed, not archived — `<> 'Archived'` would drop the
-- rows that predate the column, which is why it reads as it does.
-- Dropped rather than replaced: `create or replace view` refuses a change of
-- column order, and this one gains uuid in second place.
drop view if exists xano_mirror.project_contracts;
create view xano_mirror.project_contracts as
  select ct.id,
         ct.uuid,
         ct.project_master_list_id,
         ct.file_name,
         ct.file_type,
         ct.file_size,
         ct.description,
         ct.contract_type as contract_type_id,
         t.type as contract_type,
         ct.supplier_list_id,
         s.title as supplier,
         ct.artist,
         ct.song_name,
         ct.notes,
         ct.status,
         ct.confirmed,
         ct.start_date,
         ct.end_date,
         ct.term_value,
         ct.term_unit,
         ct.perpetual,
         ct.renewal_notify_at,
         ct.renewal_notified_at,
         ct.master_pct,
         ct.publishing_pct,
         ct.mcps_yn,
         ct.supplier_address,
         ct.url,
         ct.created_at
    from xano_mirror.contracts ct
    left join xano_mirror.contract_types t on t.id = ct.contract_type
    left join xano_mirror.supplier_list s on s.id = ct.supplier_list_id
   where coalesce(ct.confirmed, false)
     and ct.status is distinct from 'Archived';

grant select on xano_mirror.project_contracts to authenticated;

-- ------------------------------------------------------------------ grants
revoke all on function public.track_contract_dates(date, date, int, text, boolean) from public, anon;
revoke all on function public.track_create_contract(bigint, text, text, text) from public, anon;
revoke all on function public.track_save_contract(uuid, int, int, text, text, text, text, text, text, boolean, date, date, int, text, boolean, text) from public, anon;
revoke all on function public.track_contract_key(uuid) from public, anon;
revoke all on function public.track_archive_contract(uuid) from public, anon;
revoke all on function public.track_discard_contract(uuid) from public, anon;
revoke all on function public.track_share_contract(uuid) from public, anon;
revoke all on function public.track_contract_renewals() from public, anon;
revoke all on function public.track_mark_renewal_seen(uuid, boolean) from public, anon;

grant execute on function public.track_contract_dates(date, date, int, text, boolean) to authenticated;
grant execute on function public.track_create_contract(bigint, text, text, text) to authenticated;
grant execute on function public.track_save_contract(uuid, int, int, text, text, text, text, text, text, boolean, date, date, int, text, boolean, text) to authenticated;
grant execute on function public.track_contract_key(uuid) to authenticated;
grant execute on function public.track_archive_contract(uuid) to authenticated;
grant execute on function public.track_discard_contract(uuid) to authenticated;
grant execute on function public.track_share_contract(uuid) to authenticated;
grant execute on function public.track_contract_renewals() to authenticated;
grant execute on function public.track_mark_renewal_seen(uuid, boolean) to authenticated;

-- ------------------------------------------------- /link, now two kinds
-- resolve_share_link answered for assets only; a contract link would have
-- looked like an invalid code. Same rate limit, same shape out, plus `kind`
-- so the page can say what it is showing.
create or replace function public.resolve_share_link(p_code text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_link public.share_links;
  v_asset xano_mirror.project_assets;
  v_contract xano_mirror.contracts;
  v_key text := 'share_read_' || coalesce(nullif(p_ip, ''), 'unknown');
  v_row public.rate_limits;
begin
  insert into public.rate_limits (limit_key, hits, window_start) values (v_key, 0, now())
  on conflict (limit_key) do nothing;
  select * into v_row from public.rate_limits where limit_key = v_key for update;
  if v_row.window_start + interval '5 minutes' < now() then
    update public.rate_limits set hits = 1, window_start = now() where limit_key = v_key;
  elsif v_row.hits >= 30 then
    return jsonb_build_object('error', 'busy');
  else
    update public.rate_limits set hits = hits + 1 where limit_key = v_key;
  end if;

  select * into v_link from public.share_links s where s.code = btrim(coalesce(p_code, ''));
  if not found then
    return jsonb_build_object('error', 'invalid');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('error', 'expired');
  end if;

  if v_link.contract_uuid is not null then
    select * into v_contract from xano_mirror.contracts c where c.uuid = v_link.contract_uuid;
    -- An archived contract's links are retired on archive; this is the guard
    -- for one archived while a link was in flight.
    if not found or coalesce(v_contract.aws_path, '') = ''
       or v_contract.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'contract',
      'key', v_contract.aws_path,
      'file_name', v_contract.file_name,
      'file_type', coalesce(nullif(v_contract.file_type, ''), 'application/pdf'),
      'file_size', v_contract.file_size,
      'expires_at', v_link.expires_at
    );
  end if;

  select * into v_asset from xano_mirror.project_assets a where a.uuid = v_link.asset_uuid;
  if not found or coalesce(v_asset.aws_path, '') = '' then
    return jsonb_build_object('error', 'invalid');
  end if;
  return jsonb_build_object(
    'kind', 'asset',
    'key', v_asset.aws_path,
    'file_name', v_asset.file_name,
    'file_type', v_asset.file_type,
    'file_size', v_asset.file_size,
    'expires_at', v_link.expires_at
  );
end
$function$;
revoke all on function public.resolve_share_link(text, text) from public, anon, authenticated;
grant execute on function public.resolve_share_link(text, text) to service_role;
