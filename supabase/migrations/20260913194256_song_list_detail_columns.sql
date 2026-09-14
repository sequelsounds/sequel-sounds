-- The fields /song's six tabs show, joining song_list so the list and the
-- song page read one view. Dropped and recreated rather than replaced, since
-- create or replace cannot insert columns mid-list.
drop view xano_mirror.song_list;

create view xano_mirror.song_list
with (security_invoker = true) as
select
  s.id,
  s.uuid,
  s.track_title,
  s.composer,
  s.brand,
  s.project,
  s.project_master_list_id,
  s.registration_status,
  s.schedule_a_status,
  s.ownership,
  s.duration,
  s.tunecode,
  s.status,
  s.alternative_titles,
  s.agreement_number,
  s.prs_registration_date,
  s.commencement_date,
  s.clock_numbers,
  s.campaign_description,
  s.script_title,
  s.advertising_agency,
  s.notes,
  s.supplier_list_id,
  sl.title as supplier_title,
  sl.uuid as supplier_uuid
from xano_mirror.sequel_songs s
left join xano_mirror.supplier_list sl on sl.id = s.supplier_list_id
where s.status = 'Active';

grant select on xano_mirror.song_list to authenticated;
