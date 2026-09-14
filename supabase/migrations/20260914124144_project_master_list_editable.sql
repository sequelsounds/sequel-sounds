-- Editing a project. Same shape as suppliers: column grants say which fields,
-- the policy says who, and the trigger says the things a policy cannot express.
--
-- As with creation, all of it is skipped when auth.uid() is null so the hourly
-- Xano sync keeps writing unchanged.

create or replace function xano_mirror.project_master_list_update_guard()
returns trigger
language plpgsql
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $fn$
declare
  v_missing text[] := '{}';
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Identity is the database's, not the caller's. Column grants already stop
  -- these arriving in an UPDATE; this is the second lock on the same door.
  new.id              := old.id;
  new.uuid            := old.uuid;
  new.sequel_no       := old.sequel_no;
  new.created_at      := old.created_at;
  new.created_at_dup2 := old.created_at_dup2;

  -- A project cannot be emptied out after the fact either.
  if coalesce(btrim(new.title), '')        = '' then v_missing := array_append(v_missing, 'title');            end if;
  if coalesce(btrim(new.brand), '')        = '' then v_missing := array_append(v_missing, 'brand');            end if;
  if coalesce(btrim(new.product), '')      = '' then v_missing := array_append(v_missing, 'product');          end if;
  if coalesce(btrim(new.campaignname), '') = '' then v_missing := array_append(v_missing, 'campaign name');    end if;
  if coalesce(btrim(new.project_type), '') = '' then v_missing := array_append(v_missing, 'project type');     end if;
  if coalesce(btrim(new.country), '')      = '' then v_missing := array_append(v_missing, 'country');          end if;
  if coalesce(new.client, 0)           = 0 then v_missing := array_append(v_missing, 'client group');      end if;
  if coalesce(new.brand_category, 0)   = 0 then v_missing := array_append(v_missing, 'brand category');    end if;
  if coalesce(new.music_supervisor, 0) = 0 then v_missing := array_append(v_missing, 'music supervisor');  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'A project cannot be left without its %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  new.sp_id            := nullif(new.sp_id, 0);
  new.client           := nullif(new.client, 0);
  new.client_agency    := nullif(new.client_agency, 0);
  new.brand_category   := nullif(new.brand_category, 0);
  new.music_supervisor := nullif(new.music_supervisor, 0);
  new.services_id      := nullif(new.services_id, 0);
  new.client_user_id   := nullif(new.client_user_id, 0);
  new.adpro_user       := nullif(new.adpro_user, 0);

  new.updated_at := now();
  new.updated_by := public.track_user_id();

  return new;
end
$fn$;

drop trigger if exists project_master_list_update_guard on xano_mirror.project_master_list;
create trigger project_master_list_update_guard
  before update on xano_mirror.project_master_list
  for each row execute function xano_mirror.project_master_list_update_guard();

grant update (
  title, brand, product, campaignname, project_type, country, project_currency,
  client, client_agency, brand_category, music_supervisor, services_id,
  client_user_id, adpro_user, projects_status, status, sequel_ownership,
  brand_group, concept, notesorrequest, notes, next_action, extension_yn,
  proposed_start_date, proposed_air_date, pipeline_gbp, totalbudget,
  term, territory, media, scripts, durations, cutdowns,
  proposed_artist, proposed_song,
  confirmed_performing_artist, confirmed_song_name, confirmed_first_air_date,
  winning_composition_team, cancellation_reason, cancellation_date,
  finaldiscolink, disco_inbox_link, external_briefing_link, library_quote_link,
  client_project_assets_url, project_assets_disco_url
) on xano_mirror.project_master_list to authenticated;

drop policy if exists project_master_list_staff_update on xano_mirror.project_master_list;
create policy project_master_list_staff_update
  on xano_mirror.project_master_list
  for update to authenticated
  using (public.track_is_staff())
  with check (public.track_is_staff());

comment on function xano_mirror.project_master_list_update_guard() is
  'Keeps id, uuid, Sequel No. and created_at out of an editor''s hands, refuses to '
  'leave a project without its nine required fields, and stamps updated_at/by. '
  'Skipped when auth.uid() is null so the hourly Xano sync writes unchanged.';
