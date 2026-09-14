-- xano_mirror.partner_list — Track's get_all_suppliers (535), behind /partners.
-- xano_mirror.roster_list — Track's get_roster (531), behind /roster.
--
-- One table, split by type. get_all_suppliers is everything that is NOT a
-- Composition Team; get_roster is only the Composition Teams. Despite its
-- name and its copied description, get_all_suppliers does not return them all.
--
-- ⚠️ NEITHER ENDPOINT SORTS. Both are a bare db.query with no `sort`, so Track
-- shows whatever order the store hands back — which today begins id 8, 149,
-- 113, 22, 111 and is heap order, not an order anyone chose. It changes when a
-- supplier is edited. There is nothing to reproduce, so these views order by
-- title and the page says so: a stable order where Track has an arbitrary one.
--
-- `<>` rather than `is distinct from`, matching Xano's `!=`: a supplier with no
-- type set is excluded from both lists, in both systems. There are none today.
create or replace view xano_mirror.partner_list
with (security_invoker = true) as
select
  s.id,
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
  s.ca_status,
  s.vat_registered,
  s.qbo_vendor_id,
  s.default_currency_id,
  s.countries_list_id as country_id,
  co.country as country_text,
  s.regions_id as region_id,
  r.region as region_text
from xano_mirror.supplier_list s
left join xano_mirror.countries_list co on co.id = s.countries_list_id
left join xano_mirror.regions r on r.id = s.regions_id
where s.supplier_type <> 'Composition Team';

create or replace view xano_mirror.roster_list
with (security_invoker = true) as
select
  s.id,
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
  s.countries_list_id as country_id,
  co.country as country_text,
  s.regions_id as region_id,
  r.region as region_text
from xano_mirror.supplier_list s
left join xano_mirror.countries_list co on co.id = s.countries_list_id
left join xano_mirror.regions r on r.id = s.regions_id
where s.supplier_type = 'Composition Team';

grant select on xano_mirror.partner_list to authenticated;
grant select on xano_mirror.roster_list to authenticated;
