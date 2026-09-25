-- 24 Sep 2026. Composition team onboarding and the composer agreement, signed
-- in the app (Andy): replaces adding a team by hand and BoldSign.
--
--   1. Staff add a team by email only. The row is created as Invited, titled
--      with the email, and the team gets a link to a form.
--   2. The team fills in its own details (the roster fields, plus the legal
--      name and business address the agreement needs). The row becomes
--      Details received. Until then it cannot be opened.
--   3. Staff press Request agreement. Andy reviews the filled-in agreement and
--      signs for Sequel; only then is it emailed to the team's contract email.
--   4. The team signs. The signed PDF (with a signature record page) is stored
--      in S3 under contracts/, and ca_status becomes Complete.
--
-- supplier_list left the Xano sync on 13 Sep, so new columns are safe here.

alter table xano_mirror.supplier_list
  add column if not exists legal_name text,
  add column if not exists business_address text,
  add column if not exists onboarding_status text,
  add column if not exists agreement_stage text,
  add column if not exists ca_pdf_key text,
  add column if not exists ca_signed_at timestamptz;

alter table xano_mirror.supplier_list drop constraint if exists supplier_list_onboarding_chk;
alter table xano_mirror.supplier_list add constraint supplier_list_onboarding_chk
  check (onboarding_status is null or onboarding_status in ('Invited', 'Details received'));

alter table xano_mirror.supplier_list drop constraint if exists supplier_list_agreement_stage_chk;
alter table xano_mirror.supplier_list add constraint supplier_list_agreement_stage_chk
  check (agreement_stage is null or agreement_stage in ('awaiting_sequel', 'awaiting_composer'));

comment on column xano_mirror.supplier_list.onboarding_status is
  'Invited: emailed a form, nothing filled in yet (the row cannot be opened). Details received: the team filled it in. Null for every team added before 24 Sep 2026.';
comment on column xano_mirror.supplier_list.agreement_stage is
  'The composer agreement in flight: awaiting_sequel (Andy to review and sign), awaiting_composer (sent). Null when none is in flight; ca_status says whether one is signed.';

-- The tokens and the signature record. Service role only: no policies.
create table if not exists public.track_roster_onboarding (
  supplier_id bigint primary key references xano_mirror.supplier_list(id) on delete cascade,
  invite_token text unique,
  invite_email text,
  invited_by bigint,
  invited_at timestamptz,
  invite_email_error text,
  details_at timestamptz,
  agreement_uuid uuid,
  agreement_token text unique,
  requested_by bigint,
  requested_at timestamptz,
  details jsonb,
  company_name text,
  company_signed_at timestamptz,
  company_ip text,
  company_agent text,
  sent_to text,
  sent_at timestamptz,
  send_error text,
  composer_name text,
  composer_signed_at timestamptz,
  composer_ip text,
  composer_agent text,
  consent text,
  details_sha256 text,
  pdf_sha256 text,
  pdf_key text,
  signed_copy_error text
);
alter table public.track_roster_onboarding enable row level security;
revoke all on public.track_roster_onboarding from anon, authenticated;

-- The roster list carries the three new states. Appended at the end: a view's
-- columns cannot be reordered by create or replace.
create or replace view xano_mirror.roster_list as
 SELECT s.id,
    s.uuid,
    s.title,
    s.supplier_type,
    s.briefing_list,
    s.approved,
    s.strengths,
    s.brief_email,
    s.finance_email,
    s.website,
    s.phone_number,
    s.city,
    s.bio,
    s.studio_setup,
    s.stand_out_work,
    s.composition_showreel,
    s.sounddesign_showreel,
    s.final_mix_showreel,
    s.library_link,
    s.access_to_vocalist,
    s.sound_design,
    s.final_mix,
    s.composer_library,
    s.ca_status,
    s.qbo_vendor_id,
    s.countries_list_id AS country_id,
    co.country AS country_text,
    s.regions_id AS region_id,
    r.region AS region_text,
    s.status,
    s.contract_email,
    s.legal_name,
    s.business_address,
    s.onboarding_status,
    s.agreement_stage,
    s.ca_signed_at,
    (s.ca_pdf_key is not null) AS has_agreement
   FROM ((xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON ((co.id = s.countries_list_id)))
     LEFT JOIN xano_mirror.regions r ON ((r.id = s.regions_id)))
  WHERE (s.supplier_type = 'Composition Team'::text);

-- 0081b. Staff can correct the two new details on the Contact tab. Nothing
-- else new is writable from the browser: the onboarding and agreement states,
-- and the file's key, are set by the roster-onboarding function only. (The key
-- is readable, as the whole table is to staff; the file itself only opens
-- through the function's short signed link.)
grant update (legal_name, business_address) on xano_mirror.supplier_list to authenticated;
