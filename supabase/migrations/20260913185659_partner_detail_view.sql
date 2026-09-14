-- xano_mirror.partner_detail — Track's get_supplier (533), behind /partner-edit.
--
-- The contact set lives here rather than on partner_list: get_supplier was
-- switched from auth = false to auth = user on 22 August precisely because it
-- was handing the whole row — brief, finance and clearance emails, phone,
-- address and bio — to anyone holding or guessing a uuid. One record at a time,
-- to staff, is the shape that was settled on.
--
-- No type filter. get_supplier fetches by uuid alone, so this reaches a
-- composition team as readily as a publisher; which page you came from is what
-- decides the fields shown, not the query.
create or replace view xano_mirror.partner_detail
with (security_invoker = true) as
select
  s.id,
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
  s.countries_list_id as country_id,
  co.country as country_text,
  s.regions_id as region_id,
  r.region as region_text
from xano_mirror.supplier_list s
left join xano_mirror.countries_list co on co.id = s.countries_list_id
left join xano_mirror.regions r on r.id = s.regions_id;

grant select on xano_mirror.partner_detail to authenticated;
