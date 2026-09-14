-- qbo_vendor_id joins roster_list: the composition team's Finance tab shows it,
-- the same way the partner page does. Dropped and recreated rather than
-- replaced, because create or replace cannot insert a column mid-list.
drop view xano_mirror.roster_list;

create view xano_mirror.roster_list
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
  s.qbo_vendor_id,
  s.countries_list_id as country_id,
  co.country as country_text,
  s.regions_id as region_id,
  r.region as region_text
from xano_mirror.supplier_list s
left join xano_mirror.countries_list co on co.id = s.countries_list_id
left join xano_mirror.regions r on r.id = s.regions_id
where s.supplier_type = 'Composition Team';

grant select on xano_mirror.roster_list to authenticated;
