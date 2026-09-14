-- ⚠️ TWO STATUS VOCABULARIES ON ONE PROJECT.
--
-- `projects_status` is the FK into Projects Status Options — New, Quoting,
-- Creative, Approvals, Contracting, Complete, Cancelled, Archived — and it is
-- what /projects and the client page show.
--
-- `project_status` is a legacy TEXT column with a different vocabulary
-- entirely: Project Submitted, Quote(s) Supplied, Creative Development,
-- Contracting, Invoicing, Complete, Closed. The user page's Projects tab reads
-- THAT one (Project_row_status_user_edit → .Project_Status).
--
-- So the same project reads differently depending on which page you open.
-- "Sapa 2026 Extension" is Complete by the FK and Invoicing by the text. Both
-- are exposed here, named for what they are, so neither page has to guess.
drop view xano_mirror.client_projects;

create view xano_mirror.client_projects
with (security_invoker = true) as
select
  p.id,
  p.uuid,
  p.title,
  p.sequel_no,
  p.brand,
  p.campaignname as campaign_name,
  p.client_agency,
  p.client_user_id,
  p.projects_status,
  s.status as stage_text,
  p.project_status as legacy_status_text,
  p.services_id,
  sv.service as service_name,
  p.pipeline_gbp
from xano_mirror.project_master_list p
left join xano_mirror.projects_status_options s on s.id = p.projects_status
left join xano_mirror.services sv on sv.id = p.services_id
where p.status is distinct from 'Archived';

grant select on xano_mirror.client_projects to authenticated;
