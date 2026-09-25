-- 0085_partner_onboarding
--
-- Andy, 25 Sep 2026: partners (every supplier that is not a composition team)
-- are added the way roster teams are since 0081 — staff give an email, the
-- partner fills in its own details on a form (/join-partner/:token), and the
-- row shows as Invited until it has. The partner picks its own supplier type,
-- so an invited row has none yet; partner_list already takes a null type
-- (IS DISTINCT FROM 'Composition Team').
--
-- The same roster-onboarding function, token table and onboarding_status
-- column serve both. This only puts onboarding_status on the partner list,
-- appended at the end because a view's columns cannot be reordered.

create or replace view xano_mirror.partner_list as
 SELECT s.id,
    s.uuid,
    s.title,
    s.supplier_type,
    s.briefing_list,
    s.approved,
    s.strengths,
    s.brief_email,
    s.website,
    s.city,
    s.ca_status,
    s.countries_list_id AS country_id,
    co.country AS country_text,
    s.regions_id AS region_id,
    r.region AS region_text,
    s.status,
    s.onboarding_status
   FROM xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON co.id = s.countries_list_id
     LEFT JOIN xano_mirror.regions r ON r.id = s.regions_id
  WHERE s.supplier_type IS DISTINCT FROM 'Composition Team'::text;
