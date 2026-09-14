-- Matches Xano's assert_project_access exactly: staff bypass, otherwise the caller
-- must be named on the project as the client contact, the adpro user, or the music
-- supervisor. Deliberately NOT company-wide -- Xano does not grant access by agency,
-- and a migration must not quietly widen what clients can see.
create or replace function public.track_can_see_project(p_project bigint)
returns boolean
language sql stable security definer set search_path = public, xano_mirror, pg_catalog as $fn$
  select public.track_is_staff()
      or exists (
           select 1 from xano_mirror.project_master_list p
            where p.id = p_project
              and ( (p.client_user_id    is not null and p.client_user_id    = public.track_user_id())
                 or (p.adpro_user        is not null and p.adpro_user        = public.track_user_id())
                 or (p.music_supervisor  is not null and p.music_supervisor  = public.track_user_id()) ));
$fn$;
