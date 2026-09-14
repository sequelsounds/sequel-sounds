-- `supplier_type <> 'Composition Team'` is NULL for a supplier with no type,
-- and NULL is not true, so an untyped supplier appeared on NEITHER list: not on
-- /partners because the test is not true, and not on /roster because it is not
-- a composition team. The record would exist, be editable by URL, and be
-- reachable from nowhere.
--
-- It has never happened, because until today nothing could create a supplier
-- and every row came from Xano with a type. It becomes reachable the moment a
-- create form exists, which is why this changes now.
--
-- `is distinct from` treats NULL as a value, so an untyped supplier lands on
-- /partners — the right side, since /roster is by definition the ones that ARE
-- composition teams. The create form asks for a type anyway; this is the
-- backstop for a row that gets one removed later.
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
  s.website,
  s.city,
  s.ca_status,
  s.countries_list_id as country_id,
  co.country as country_text,
  s.regions_id as region_id,
  r.region as region_text
from xano_mirror.supplier_list s
  left join xano_mirror.countries_list co on co.id = s.countries_list_id
  left join xano_mirror.regions r on r.id = s.regions_id
where s.supplier_type is distinct from 'Composition Team';
