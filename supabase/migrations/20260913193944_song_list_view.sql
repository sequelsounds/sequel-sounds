-- xano_mirror.song_list — Track's Get_songs (536), behind /songs.
--
-- The Sequel Songs Sequel composed for a client, and the ones that get
-- registered with the PROs.
--
-- ⚠️ The filter is `= 'Active'`, NOT `is distinct from 'Archived'`. Every other
-- list in Track excludes the archived and keeps a blank status; this one keeps
-- only the explicitly Active, so a song with no status set is absent here and
-- would be present on the equivalent client or supplier list. Reproduced as it
-- is — all 14 rows carry a status today, so nothing is hidden by it yet.
--
-- The composer name is resolved through supplier_list, which is what Track's
-- Supplier_List addon does; the row's own `composer` text is kept alongside it
-- because the page's Composer column reads that, not the join.
create or replace view xano_mirror.song_list
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
  s.supplier_list_id,
  sl.title as supplier_title,
  sl.uuid as supplier_uuid
from xano_mirror.sequel_songs s
left join xano_mirror.supplier_list sl on sl.id = s.supplier_list_id
where s.status = 'Active';

grant select on xano_mirror.song_list to authenticated;
