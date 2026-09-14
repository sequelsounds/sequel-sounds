drop view if exists xano_mirror.management_projects;

-- ⚠️ THE PROJECT'S CREATION DATE IS `created_at_dup2`, NOT `created_at`.
-- Project Master List carries both. `created_at` is TEXT and is not a Xano
-- timestamp at all: 172 rows hold `2025-11-04T10:03:43.000Z`, 21 hold
-- `13/02/2026 09:51` in UK order, one holds a bare newline, and 47 hold
-- nothing. `created_at_dup2` is a proper date, set on 226 of the 241 rows —
-- exactly the 226 the endpoint returns, 44 in 2025 and 182 in 2026, matching
-- Track row for row.
--
-- Reading the text column instead cost an hour and produced a confident wrong
-- conclusion — that Track was silently dropping 21 projects from its chart.
-- It is not. ⚠️ Check which column the ENDPOINT reads before believing the
-- one whose name looks right.
--
-- The 15 rows with no date are the SharePoint placeholder shells held open
-- for projects arriving from SharePoint; the endpoint skips them too.
create view xano_mirror.management_projects
with (security_invoker = true) as
select
  p.id,
  p.created_at_dup2             as created_at,
  p.music_supervisor            as supervisor_id,
  p.brand,
  p.client,
  coalesce(p.brand_category, 0) as category_id
from xano_mirror.project_master_list p
where public.track_is_management()
  -- `status` is Xano's Status, the archive flag. Every row reads 'Active'
  -- today, so this removes nothing — it is here because the endpoint has it
  -- and the day something is archived both should agree.
  and p.status is distinct from 'Archived'
  and p.created_at_dup2 is not null;

comment on view xano_mirror.management_projects is
  'Live projects with a creation date, for the /management Projects series. Reads created_at_dup2, which is Xano created_at. Management only.';

grant select on xano_mirror.management_projects to authenticated;

