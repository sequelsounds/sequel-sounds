-- Widened to carry every field the Sequel Track project page actually shows,
-- read off the live page rather than guessed. CREATE OR REPLACE cannot
-- reorder or rename a view's columns, so this drops and rebuilds.
drop view if exists xano_mirror.project_list;

create view xano_mirror.project_list
with (security_invoker = true) as
select p.id,
       nullif(trim(p.title), '')            as title,
       nullif(trim(p.sequel_no), '')        as sequel_no,
       nullif(trim(p.brand), '')            as brand,
       nullif(trim(p.campaignname), '')     as campaign_name,
       nullif(trim(p.product), '')          as product,
       nullif(trim(p.brand_no), '')         as brand_no,
       nullif(trim(p.project_type), '')     as project_type,
       s.status                             as stage,
       p.status                             as record_status,
       cg.client                            as client_group,
       c.company                            as agency,
       nullif(trim(p.country), '')          as country,
       r.region                             as region,
       bc.category                          as brand_category,
       sv.service                           as service,
       sup.name                             as supervisor,
       adp.name                             as adpro_lead,
       cu.name                              as client_user,
       nullif(trim(p.term), '')             as term,
       nullif(trim(p.territory), '')        as territory,
       nullif(trim(p.media), '')            as media,
       nullif(trim(p.scripts), '')          as scripts,
       nullif(trim(p.durations), '')        as durations,
       p.cutdowns,
       p.extension_yn,
       nullif(trim(p.proposed_start_date), '') as proposed_start_date,
       p.proposed_air_date,
       p.confirmed_first_air_date,
       p.created_at,
       p.pipeline_gbp,
       nullif(trim(p.studio_inbox_link), '')   as studio_inbox_link,
       nullif(trim(p.studio_link), '')         as studio_link,
       nullif(trim(p.disco_inbox_link), '')    as disco_inbox_link,
       nullif(trim(p.finaldiscolink), '')      as final_disco_link,
       nullif(trim(p.notes), '')               as notes,
       nullif(trim(p.notesorrequest), '')      as notes_or_request
from xano_mirror.project_master_list p
left join xano_mirror.projects_status_options s  on s.id  = p.projects_status
left join xano_mirror.client_groups            cg on cg.id = p.client
left join xano_mirror.clients                  c  on c.id  = p.client_agency
left join xano_mirror.regions                  r  on r.id  = c.region
left join xano_mirror.brand_category           bc on bc.id = p.brand_category
left join xano_mirror.services                 sv on sv.id = p.services_id
left join xano_mirror."user"                   sup on sup.id = p.music_supervisor
left join xano_mirror."user"                   adp on adp.id = p.adpro_user
left join xano_mirror."user"                   cu  on cu.id  = p.client_user_id;

revoke all on xano_mirror.project_list from anon, public;
grant select on xano_mirror.project_list to authenticated;
