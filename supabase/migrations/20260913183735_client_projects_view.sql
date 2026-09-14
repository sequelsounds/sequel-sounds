-- xano_mirror.client_projects — Track's get_client_projects (api 582).
--
-- The Projects tab and the four service counters on /client, both off this
-- one view exactly as Track runs them off one request.
--
-- ⚠️ The link is `client_agency`, not `client`. Project Master List carries
-- two client-ish columns: `client` is an FK to Client Groups (table 30) and
-- `client_agency` is the FK to Clients (table 16). This page is a Clients row,
-- so client_agency is the one. Getting it wrong returns nothing rather than
-- the wrong thing, which at least fails loudly.
--
-- services_id travels alongside the name so the counters can key on the id —
-- 1 Composition, 2 Commercial, 3 Library, 4 Sonic Branding, 5 Sound Design,
-- 6 Talent — rather than matching display strings that a rename would break.
--
-- Archived projects are excluded with `is distinct from`, so a row with a null
-- or blank status still appears; the same rule as the projects list and the
-- clients list.
create or replace view xano_mirror.client_projects
with (security_invoker = true) as
select
  p.id,
  p.uuid,
  p.title,
  p.sequel_no,
  p.brand,
  p.campaignname as campaign_name,
  p.client_agency,
  p.projects_status,
  s.status as stage_text,
  p.services_id,
  sv.service as service_name,
  p.pipeline_gbp
from xano_mirror.project_master_list p
left join xano_mirror.projects_status_options s on s.id = p.projects_status
left join xano_mirror.services sv on sv.id = p.services_id
where p.status is distinct from 'Archived';

grant select on xano_mirror.client_projects to authenticated;
