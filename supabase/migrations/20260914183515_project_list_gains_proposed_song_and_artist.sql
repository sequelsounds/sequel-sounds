-- The quote wizard prefills its track from the project, as the old app does.
--
-- ⚠️ `proposed_song` / `proposed_artist`, never `confirmed_song_name` /
-- `confirmed_performing_artist`. Those two record the track that was actually
-- signed off, and a draft quote must neither read from nor overwrite them.
--
-- ⚠️ APPENDED. `create or replace view` cannot reorder or rename an existing
-- column, only add to the end.
create or replace view xano_mirror.project_list with (security_invoker = true) as
 SELECT p.id,
    NULLIF(btrim(p.title), ''::text) AS title,
    NULLIF(btrim(p.sequel_no), ''::text) AS sequel_no,
    NULLIF(btrim(p.brand), ''::text) AS brand,
    NULLIF(btrim(p.campaignname), ''::text) AS campaign_name,
    NULLIF(btrim(p.product), ''::text) AS product,
    NULLIF(btrim(p.brand_no), ''::text) AS brand_no,
    NULLIF(btrim(p.project_type), ''::text) AS project_type,
    s.status AS stage,
    p.status AS record_status,
    cg.client AS client_group,
    c.company AS agency,
    NULLIF(btrim(p.country), ''::text) AS country,
    r.region,
    bc.category AS brand_category,
    sv.service,
    sup.name AS supervisor,
    adp.name AS adpro_lead,
    cu.name AS client_user,
    cu.email AS client_user_email,
    NULLIF(btrim(p.term), ''::text) AS term,
    NULLIF(btrim(p.territory), ''::text) AS territory,
    NULLIF(btrim(p.media), ''::text) AS media,
    NULLIF(btrim(p.scripts), ''::text) AS scripts,
    NULLIF(btrim(p.durations), ''::text) AS durations,
    p.cutdowns,
    p.extension_yn,
    NULLIF(btrim(p.proposed_start_date), ''::text) AS proposed_start_date,
    p.proposed_air_date,
    p.confirmed_first_air_date,
    p.closedcancelled_date AS closed_cancelled_date,
    p.created_at,
    p.pipeline_gbp,
    NULLIF(btrim(p.studio_inbox_link), ''::text) AS studio_inbox_link,
    NULLIF(btrim(p.studio_link), ''::text) AS studio_link,
    NULLIF(btrim(p.disco_inbox_link), ''::text) AS disco_inbox_link,
    NULLIF(btrim(p.finaldiscolink), ''::text) AS final_disco_link,
    NULLIF(btrim(p.notes), ''::text) AS notes,
    NULLIF(btrim(p.notesorrequest), ''::text) AS notes_or_request,
    p.projects_status AS status_id,
    p.music_supervisor AS supervisor_id,
    ucc.company AS client_user_company,
    p.client_user_id,
    p.client AS client_group_id,
    p.client_agency AS agency_id,
    p.brand_category AS brand_category_id,
    p.services_id AS service_id,
    p.adpro_user AS adpro_user_id,
    NULLIF(btrim(p.sequel_ownership), ''::text) AS sequel_ownership,
    NULLIF(btrim(p.concept), ''::text) AS concept,
    p.updated_at,
    NULLIF(btrim(p.proposed_song), ''::text) AS proposed_song,
    NULLIF(btrim(p.proposed_artist), ''::text) AS proposed_artist
   FROM xano_mirror.project_master_list p
     LEFT JOIN xano_mirror.projects_status_options s ON s.id = p.projects_status
     LEFT JOIN xano_mirror.client_groups cg ON cg.id = p.client
     LEFT JOIN xano_mirror.clients c ON c.id = p.client_agency
     LEFT JOIN xano_mirror.regions r ON r.id = c.region
     LEFT JOIN xano_mirror.brand_category bc ON bc.id = p.brand_category
     LEFT JOIN xano_mirror.services sv ON sv.id = p.services_id
     LEFT JOIN xano_mirror."user" sup ON sup.id = p.music_supervisor
     LEFT JOIN xano_mirror."user" adp ON adp.id = p.adpro_user
     LEFT JOIN xano_mirror."user" cu ON cu.id = p.client_user_id
     LEFT JOIN xano_mirror.clients ucc ON ucc.id = cu.company;

grant select on xano_mirror.project_list to authenticated;

