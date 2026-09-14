-- ⚠️ The song page's "Ad Agency" is NOT the song's own Advertising_Agency
-- column. Track reads
--   get_song.data._project_master_list._clients.Company
-- — the song's project, that project's client_agency, that client's Company.
-- The two disagree in the data: "Go Go Noodles" carries "UStudios" in its own
-- column while its project's client is Oliver London, and Track shows Oliver
-- London.
--
-- Worth knowing why this was easy to get wrong: there are TWO Wized elements
-- named Sequel_song_ad_agency, one reading each source. The one bound to the
-- project's client is the one that renders.
--
-- Both are exposed here: ad_agency is what the page shows, advertising_agency
-- is the row's own value, kept so the disagreement stays visible.
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
  c.company as ad_agency,
  s.notes,
  s.supplier_list_id,
  sl.title as supplier_title,
  sl.uuid as supplier_uuid
from xano_mirror.sequel_songs s
left join xano_mirror.supplier_list sl on sl.id = s.supplier_list_id
left join xano_mirror.project_master_list p on p.id = s.project_master_list_id
left join xano_mirror.clients c on c.id = p.client_agency
where s.status = 'Active';

grant select on xano_mirror.song_list to authenticated;
