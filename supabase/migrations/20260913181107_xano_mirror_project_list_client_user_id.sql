-- The raw FK, so the list can reproduce Track's behaviour exactly.
-- get_staff_projects reaches the client user with an inner join, so a project
-- whose Client_user_id is unset never reaches the page. Testing the joined
-- name instead would also drop a project whose user happens to have no name,
-- which is a different rule.
create or replace view xano_mirror.project_list with (security_invoker = true) as
select p.id,
       nullif(btrim(p.title), '')          as title,
       nullif(btrim(p.sequel_no), '')      as sequel_no,
       nullif(btrim(p.brand), '')          as brand,
       nullif(btrim(p.campaignname), '')   as campaign_name,
       nullif(btrim(p.product), '')        as product,
       nullif(btrim(p.brand_no), '')       as brand_no,
       nullif(btrim(p.project_type), '')   as project_type,
       s.status                            as stage,
       p.status                            as record_status,
       cg.client                           as client_group,
       c.company                           as agency,
       nullif(btrim(p.country), '')        as country,
       r.region,
       bc.category                         as brand_category,
       sv.service,
       sup.name                            as supervisor,
       adp.name                            as adpro_lead,
       cu.name                             as client_user,
       cu.email                            as client_user_email,
       nullif(btrim(p.term), '')           as term,
       nullif(btrim(p.territory), '')      as territory,
       nullif(btrim(p.media), '')          as media,
       nullif(btrim(p.scripts), '')        as scripts,
       nullif(btrim(p.durations), '')      as durations,
       p.cutdowns,
       p.extension_yn,
       nullif(btrim(p.proposed_start_date), '') as proposed_start_date,
       p.proposed_air_date,
       p.confirmed_first_air_date,
       p.closedcancelled_date              as closed_cancelled_date,
       p.created_at,
       p.pipeline_gbp,
       nullif(btrim(p.studio_inbox_link), '') as studio_inbox_link,
       nullif(btrim(p.studio_link), '')       as studio_link,
       nullif(btrim(p.disco_inbox_link), '')  as disco_inbox_link,
       nullif(btrim(p.finaldiscolink), '')    as final_disco_link,
       nullif(btrim(p.notes), '')             as notes,
       nullif(btrim(p.notesorrequest), '')    as notes_or_request,
       p.projects_status                      as status_id,
       p.music_supervisor                     as supervisor_id,
       ucc.company                            as client_user_company,
       p.client_user_id                       as client_user_id
  from xano_mirror.project_master_list p
  left join xano_mirror.projects_status_options s on s.id = p.projects_status
  left join xano_mirror.client_groups cg on cg.id = p.client
  left join xano_mirror.clients c        on c.id  = p.client_agency
  left join xano_mirror.regions r        on r.id  = c.region
  left join xano_mirror.brand_category bc on bc.id = p.brand_category
  left join xano_mirror.services sv      on sv.id = p.services_id
  left join xano_mirror."user" sup       on sup.id = p.music_supervisor
  left join xano_mirror."user" adp       on adp.id = p.adpro_user
  left join xano_mirror."user" cu        on cu.id  = p.client_user_id
  left join xano_mirror.clients ucc      on ucc.id = cu.company;
