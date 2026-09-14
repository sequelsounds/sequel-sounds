-- Flattens the four lookup joins a projects list needs.
-- security_invoker = true so the view runs as the caller and the RLS on
-- project_master_list still applies -- without it a view would hand every
-- signed-in user every project.
create or replace view xano_mirror.project_list
with (security_invoker = true) as
select p.id,
       nullif(trim(p.title), '')      as title,
       nullif(trim(p.sequel_no), '')  as sequel_no,
       nullif(trim(p.brand), '')      as brand,
       s.status                       as stage,
       cg.client                      as client_group,
       c.company                      as agency,
       sv.service                     as service,
       u.name                         as supervisor,
       p.proposed_air_date,
       p.confirmed_first_air_date,
       p.pipeline_gbp,
       p.status                       as record_status,
       p.studio_link,
       p.studio_inbox_link
from xano_mirror.project_master_list p
left join xano_mirror.projects_status_options s on s.id = p.projects_status
left join xano_mirror.client_groups            cg on cg.id = p.client
left join xano_mirror.clients                  c on c.id = p.client_agency
left join xano_mirror.services                 sv on sv.id = p.services_id
left join xano_mirror."user"                   u on u.id = p.music_supervisor;

comment on view xano_mirror.project_list is
  'Read-only flattened project list for the Track pages. security_invoker, so RLS on project_master_list decides visibility.';

revoke all on xano_mirror.project_list from anon, public;
grant select on xano_mirror.project_list to authenticated;
