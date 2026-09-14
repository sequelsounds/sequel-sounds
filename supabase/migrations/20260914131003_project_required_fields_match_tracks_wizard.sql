-- The required set was wrong, and wrong in a way that would have refused a
-- project created the way Track creates one.
--
-- It was derived from what existing projects have filled in — product, campaign
-- name and country are on 183 of 183 — rather than from Track's New Project
-- wizard, which asks for none of those. Those three get filled in later, on the
-- project page. Requiring them at creation would have blocked the real flow.
--
-- The list below is Track's wizard, step for step. Every step is required
-- except step 5, Client Job No, which is the one question without an asterisk
-- and the one key its `is_form_complete` exempts.
--
--   1  Which user is this project for?   client_user_id
--   2  And which Brand?                  brand
--   3  The project title?                title
--   4  And the Client?                   client_agency
--   5  Client Job No          (optional) brand_no
--   6  Project Type?                     services_id
--   7  Projected Pipeline in GBP         pipeline_gbp
--   8  Proposed start date               proposed_start_date
--   9  Account                           client
--   10 AdPro Lead                        adpro_user
--   11 Brand Category                    brand_category
--
-- The supervisor is not asked for. Xano writes it server-side as the caller, so
-- this does the same.
create or replace function xano_mirror.project_master_list_create_guard()
returns trigger
language plpgsql
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $fn$
declare
  v_missing text[] := '{}';
  v_counter int;
  v_brand3  text;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Never asked, always the caller — as Xano's own POST does it.
  new.music_supervisor := coalesce(nullif(new.music_supervisor, 0), public.track_user_id());

  if coalesce(btrim(new.title), '')               = '' then v_missing := array_append(v_missing, 'the project title');      end if;
  if coalesce(btrim(new.brand), '')               = '' then v_missing := array_append(v_missing, 'brand');                  end if;
  if coalesce(btrim(new.proposed_start_date), '') = '' then v_missing := array_append(v_missing, 'proposed start date');    end if;
  if coalesce(new.client_user_id, 0)  = 0 then v_missing := array_append(v_missing, 'the user it is for');  end if;
  if coalesce(new.client_agency, 0)   = 0 then v_missing := array_append(v_missing, 'the client');          end if;
  if coalesce(new.services_id, 0)     = 0 then v_missing := array_append(v_missing, 'project type');        end if;
  if coalesce(new.client, 0)          = 0 then v_missing := array_append(v_missing, 'account');             end if;
  if coalesce(new.adpro_user, 0)      = 0 then v_missing := array_append(v_missing, 'AdPro lead');          end if;
  if coalesce(new.brand_category, 0)  = 0 then v_missing := array_append(v_missing, 'brand category');      end if;
  if new.music_supervisor is null     then v_missing := array_append(v_missing, 'a supervisor (no Track user for this account)'); end if;
  if new.pipeline_gbp is null         then v_missing := array_append(v_missing, 'projected pipeline');      end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Cannot create project: missing %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  -- Xano's zero-means-null, on the way in
  new.sp_id            := nullif(new.sp_id, 0);
  new.client           := nullif(new.client, 0);
  new.client_agency    := nullif(new.client_agency, 0);
  new.brand_category   := nullif(new.brand_category, 0);
  new.services_id      := nullif(new.services_id, 0);
  new.client_user_id   := nullif(new.client_user_id, 0);
  new.adpro_user       := nullif(new.adpro_user, 0);

  -- Sequel No. is ours to allocate, never the caller's to choose.
  perform pg_advisory_xact_lock(hashtext('xano_mirror.project_master_list.sequel_no'));

  select coalesce(max((regexp_match(sequel_no, '^([0-9]+)-'))[1]::int), 0) + 1
    into v_counter
    from xano_mirror.project_master_list
   where sequel_no ~ '^[0-9]+-';

  v_brand3 := upper(substr(regexp_replace(new.brand, '[^A-Za-z]', '', 'g'), 1, 3));

  new.sequel_no := v_counter || '-' || v_brand3 || '-' || to_char(now(), 'YY') || '-II';

  new.projects_status  := coalesce(new.projects_status, 1);            -- New
  new.status           := coalesce(nullif(btrim(new.status), ''), 'Active');
  new.sequel_ownership := coalesce(nullif(btrim(new.sequel_ownership), ''), 'None');

  -- Campaign name is deliberately NOT filled in. Xano writes the literal string
  -- "CampaignName" into every new project, which is a bug, not a default: it
  -- puts a fake value where a blank belongs. The field is on the project page
  -- and is filled in there.

  new.created_at      := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  new.created_at_dup2 := (now() at time zone 'utc')::date;
  new.updated_at      := now();
  new.updated_by      := public.track_user_id();

  return new;
end
$fn$;

-- The update guard no longer checks required fields at all.
--
-- It cannot: the rules above describe a project created today, and most of the
-- 241 projects already in the table do not satisfy them — 34 have no client
-- user, 14 are blank stubs with no title. Enforcing the set on UPDATE would
-- have made exactly those rows impossible to edit, which is the opposite of
-- what an edit page is for. Identity is still protected.
create or replace function xano_mirror.project_master_list_update_guard()
returns trigger
language plpgsql
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $fn$
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
