-- client_user_id joins client_projects so the user page's Projects tab can
-- read the same view the client page's does. Both are Track's
-- dashboard_project_row_user_edit, five columns; only the link differs —
-- client_agency there, client_user_id here.
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
  p.services_id,
  sv.service as service_name,
  p.pipeline_gbp
from xano_mirror.project_master_list p
left join xano_mirror.projects_status_options s on s.id = p.projects_status
left join xano_mirror.services sv on sv.id = p.services_id
where p.status is distinct from 'Archived';

grant select on xano_mirror.client_projects to authenticated;
