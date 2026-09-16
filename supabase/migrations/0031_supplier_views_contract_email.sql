-- The contract email (0030) on the two supplier read views, so the roster and
-- partner pages can show and edit it. Appended at the end: `create or replace
-- view` cannot move or rename a column. partner_detail keeps security_invoker;
-- roster_list is left exactly as it was apart from the new column.

create or replace view xano_mirror.partner_detail
with (security_invoker = true) as
 SELECT s.id,
    s.uuid,
    s.title,
    s.bio,
    s.strengths,
    s.supplier_type,
    s.briefing_list,
    s.approved,
    s.brief_email,
    s.phone_number,
    s.website,
    s.city,
    s.creative_team_member_1_name,
    s.creative_team_member_1_email,
    s.creative_team_member_2_name,
    s.creative_team_member_2_email,
    s.creative_team_member_3_name,
    s.creative_team_member_3_email,
    s.clearance_contact_name_1,
    s.clearance_contact_email_1,
    s.clearance_contact_name_2,
    s.clearance_contact_email_2,
    s.finance_email,
    s.qbo_vendor_id,
    s.default_currency_id,
    s.vat_registered,
    s.ca_status,
    s.countries_list_id AS country_id,
    co.country AS country_text,
    s.regions_id AS region_id,
    r.region AS region_text,
    s.contract_email
   FROM xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON co.id = s.countries_list_id
     LEFT JOIN xano_mirror.regions r ON r.id = s.regions_id;

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
    s.contract_email
   FROM xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON co.id = s.countries_list_id
     LEFT JOIN xano_mirror.regions r ON r.id = s.regions_id
  WHERE s.supplier_type = 'Composition Team'::text;
