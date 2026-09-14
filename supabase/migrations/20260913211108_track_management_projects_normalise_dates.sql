drop view if exists xano_mirror.management_projects;

-- ⚠️ created_at ON Project Master List IS TEXT, AND IT IS NOT ALL ISO.
-- 172 rows are `2025-11-04T10:03:43.000Z`; 21 are `13/02/2026 09:51`, UK
-- order, almost certainly from the SharePoint import; one is a bare newline.
--
-- Track reads the first four characters as a year — `String(raw).slice(0, 4)`
-- — so a UK-format row yields "13/0", Number() gives NaN, and the row is
-- dropped without a sound. That is 21 live projects missing from the Projects
-- chart, every one of them inside the two years it plots.
--
-- This normalises both shapes to a plain `YYYY-MM-DD` string and drops only
-- what is genuinely undated. ⚠️ SO THE REBUILT PROJECTS CHART COUNTS MORE
-- PROJECTS THAN TRACK'S, by up to 21 across 2025 and 2026. That is deliberate
-- and it is in the known-issues note. The real fix is to the 21 rows.
--
-- Still text, not a date: the page slices the year and month off the string
-- exactly as Track does, and a cast here would only invite a timezone to move
-- a late-December project into January.
create view xano_mirror.management_projects
with (security_invoker = true) as
select
  p.id,
  case
    when p.created_at ~ '^\d{4}-\d{2}-\d{2}' then left(p.created_at, 10)
    when p.created_at ~ '^\d{2}/\d{2}/\d{4}' then
      substring(p.created_at, 7, 4) || '-' ||
      substring(p.created_at, 4, 2) || '-' ||
      substring(p.created_at, 1, 2)
  end                           as created_at,
  p.music_supervisor            as supervisor_id,
  p.brand,
  p.client,
  coalesce(p.brand_category, 0) as category_id
from xano_mirror.project_master_list p
where public.track_is_management()
  and p.status is distinct from 'Archived'
  -- The 18 SharePoint placeholder shells (ids 279-299) have no created_at at
  -- all and are skipped here exactly as the endpoint skips them.
  and (p.created_at ~ '^\d{4}-\d{2}-\d{2}' or p.created_at ~ '^\d{2}/\d{2}/\d{4}');

comment on view xano_mirror.management_projects is
  'Live projects with a usable creation date, for the /management Projects series. Dates normalised to YYYY-MM-DD text. Management only.';

grant select on xano_mirror.management_projects to authenticated;

