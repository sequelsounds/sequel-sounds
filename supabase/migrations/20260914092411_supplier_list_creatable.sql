-- Creating a supplier.
--
-- There has never been a way to do this on either stack: Xano's supplier group
-- (74) is four reads and one patch, and Track has no create form. Row 111,
-- "Huntsmen Production Music", was made by hand in the Xano table as a result —
-- and made WITHOUT A UUID, which makes it unreachable from every edit page in
-- both apps, because they are all keyed by uuid.
--
-- This is only safe now because `supplier_list` left the sync on 13 September.
-- A row created here while the table was still in task 42 would have been
-- DELETED on the hour — a full push removes rows Xano does not have.

-- The row-111 lesson, enforced rather than remembered. Nothing can create a
-- supplier without a uuid now, whatever route it comes in by — including a
-- hand-made row typed straight into the table.
alter table xano_mirror.supplier_list
  alter column uuid set default gen_random_uuid();

-- Backfill anything already missing one. Suppliers are Supabase's now, so
-- these uuids are the record rather than a copy of Xano's.
update xano_mirror.supplier_list set uuid = gen_random_uuid() where uuid is null;

-- Same column list as the update grant, and the same reasoning: `id` is the
-- sequence's, and `uuid` is the default's. Neither is the browser's to send.
grant insert (
  title,
  countries_list_id,
  vat_registered,
  supplier_type,
  briefing_list,
  strengths,
  approved,
  brief_email,
  creative_team_member_1_name,
  creative_team_member_1_email,
  creative_team_member_2_name,
  creative_team_member_2_email,
  creative_team_member_3_name,
  creative_team_member_3_email,
  clearance_contact_name_1,
  clearance_contact_email_1,
  clearance_contact_name_2,
  clearance_contact_email_2,
  finance_email,
  regions_id,
  ca_status,
  website,
  access_to_vocalist,
  composition_showreel,
  sounddesign_showreel,
  phone_number,
  stand_out_work,
  sound_design,
  final_mix,
  final_mix_showreel,
  composer_library,
  library_link,
  bio,
  city,
  studio_setup,
  default_currency_id,
  qbo_vendor_id,
  revolut_counterparty_id
) on xano_mirror.supplier_list to authenticated;

create policy supplier_list_staff_insert on xano_mirror.supplier_list
  for insert to authenticated
  with check (public.track_is_staff());

-- The update guard is BEFORE UPDATE only, so a new row gets no stamp from it.
-- An insert carries its own, and the finance check has nothing to compare
-- against on a row that did not exist a moment ago — a new supplier with a
-- payment mapping already on it is the same decision as setting one, so it
-- asks the same question.
create or replace function xano_mirror.supplier_list_insert_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $guard$
begin
  if (coalesce(new.qbo_vendor_id, '') <> ''
   or coalesce(new.default_currency_id, 0) <> 0
   or coalesce(new.revolut_counterparty_id, '') <> '')
     and not public.track_is_finance()
  then
    raise exception
      'finance access is required to set a supplier''s payment mapping'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  new.updated_by := public.track_user_id();
  return new;
end
$guard$;

create trigger supplier_list_insert_guard
  before insert on xano_mirror.supplier_list
  for each row execute function xano_mirror.supplier_list_insert_guard();
