-- MCPS-papered licences are perpetual — 18 Sep 2026.
--
-- ⚠️ Xano's rule, and it was missing from the rebuild (Andy spotted it on his
-- first real test). An MCPS-papered licence has been perpetual by default for
-- at least the last ten years, whatever Term or Valid-to date is printed on it:
-- that date bounds the Campaign Rate bracket, NOT the grant. Reading it as an
-- expiry would put a licence Sequel already owns outright into the renewal
-- chase, which is the mistake that costs a client relationship.
--
-- So MCPS now forces perpetual here, the same way a Buy Out does. The
-- extraction applies it too (sign-contract), but this is where it is decided.
-- The term-with-no-unit gate is relaxed for an MCPS licence for the same
-- reason it is for a perpetual one: there is no term to give a unit to.

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
  v_mcps      boolean := coalesce(p_mcps_yn, false);
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
  if coalesce(p_term_value, 0) > 0 and v_unit is null and not v_perpetual and not v_mcps then
    raise exception 'Say whether the term is in days, weeks, months or years.' using errcode = '22023';
  end if;

  if v_type = 'Buy Out' then
    v_perpetual := true;
  end if;
  if v_mcps then
    v_perpetual := true;
  end if;

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
         mcps_yn          = v_mcps,
         start_date       = p_start_date,
         end_date         = v_end,
         term_value       = nullif(coalesce(p_term_value, 0), 0),
         term_unit        = v_unit,
         perpetual        = v_perpetual,
         supplier_address = nullif(btrim(coalesce(p_supplier_address, '')), ''),
         renewal_notify_at = (v_dates ->> 'renewal_notify_at')::date,
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
                            'perpetual', v_perpetual, 'mcps_yn', v_mcps);
end
$function$;
