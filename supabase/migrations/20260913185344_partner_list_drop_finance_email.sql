-- finance_email comes off the list view: nothing on /partners uses it, and the
-- supplier contact fields were the reason get_supplier had to be secured in
-- August. The row's mail icon needs brief_email, so that one stays; the rest
-- of the contact set belongs to the detail view, not to a list of 93.
drop view xano_mirror.partner_list;

create view xano_mirror.partner_list
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
where s.supplier_type <> 'Composition Team';

grant select on xano_mirror.partner_list to authenticated;
