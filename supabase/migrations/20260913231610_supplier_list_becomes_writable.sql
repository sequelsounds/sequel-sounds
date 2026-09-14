-- Suppliers come off the mirror and become Supabase's own.
--
-- `supplier_list` was block 18 of Xano task 42 and is no longer synced, so this
-- table is the original now rather than a replica. That is what makes writing
-- to it safe: an hourly full push would otherwise put every edit back.
--
-- Three layers, deliberately, because each catches what the others cannot:
--   1. column grants  — which columns `authenticated` may write at all
--   2. an RLS policy  — which ROWS, and by whom (staff only)
--   3. a trigger      — the finance-only columns, which RLS cannot express
--      because a policy sees rows, not columns.

-- 1 ────────────────────────────────────────────────────────────────────────
-- `id`, `uuid` and the legacy `country_to_delete` are deliberately absent, so
-- no request from the browser can move a row's identity, however the form is
-- driven.
grant update (
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

-- 2 ────────────────────────────────────────────────────────────────────────
-- Reads are already `supplier_list_staff_read`. Writes ask the same question,
-- so a client user who can reach a project cannot reach a supplier.
create policy supplier_list_staff_update on xano_mirror.supplier_list
  for update to authenticated
  using (public.track_is_staff())
  with check (public.track_is_staff());

-- 3 ────────────────────────────────────────────────────────────────────────
-- Now that this side is the original, "when did this change, and who changed
-- it" is a real question: the two copies diverge from today and there is no
-- longer a Xano row to compare against.
alter table xano_mirror.supplier_list
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by bigint;

comment on column xano_mirror.supplier_list.updated_at is
  'Set by the write guard. Null means the row has not been edited since Supabase took ownership of this table on 13 Sep 2026.';
comment on column xano_mirror.supplier_list.updated_by is
  'xano_mirror."user".id of whoever made the edit, via public.track_user_id(). Null for a service_role write.';

create or replace function xano_mirror.supplier_list_write_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $guard$
begin
  -- The same three columns Xano's Patch_supplier (534) gates with
  -- assert_finance_access, plus revolut_counterparty_id, which postdates that
  -- endpoint and routes money the same way qbo_vendor_id does.
  --
  -- A policy cannot say this: RLS decides whether a row may be updated, not
  -- which of its columns changed. Splitting the table or giving finance its
  -- own role would both express it, and both cost more than this.
  if (new.qbo_vendor_id           is distinct from old.qbo_vendor_id
   or new.default_currency_id     is distinct from old.default_currency_id
   or new.revolut_counterparty_id is distinct from old.revolut_counterparty_id)
     and not public.track_is_finance()
  then
    raise exception
      'finance access is required to change a supplier''s payment mapping'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  new.updated_by := public.track_user_id();
  return new;
end
$guard$;

create trigger supplier_list_write_guard
  before update on xano_mirror.supplier_list
  for each row execute function xano_mirror.supplier_list_write_guard();
