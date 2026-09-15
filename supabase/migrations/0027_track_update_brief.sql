-- 16 Sep 2026. Staff can edit a brief after it has come in — Andy's call:
-- a client often adds something by email before the brief goes out to
-- suppliers, and it has to be possible to fold that in first. The old app has
-- no such edit; this is new.
--
-- One field per call, the way every other field in the app saves on blur.
-- Keys are the form's own question keys, so the brief view edits the same
-- list it displays. Staff only; archived briefs are left alone.
--
-- Not the client's rules: staff may set any real date (the 48-hour rule is
-- there to stop a client asking for the impossible, not to stop staff
-- recording what was agreed). The name still cannot be blank, and the two
-- choice questions still only take Xano's values.
create or replace function public.track_update_brief(p_brief_id bigint, p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v text := nullif(btrim(p_value), '');
  v_status text;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can edit a brief.' using errcode = '42501';
  end if;

  select b.status into v_status from xano_mirror.briefs b where b.id = p_brief_id for update;
  if not found then
    raise exception 'Brief not found.' using errcode = 'P0002';
  end if;
  if v_status = 'Archived' then
    raise exception 'This brief has been removed.' using errcode = '42501';
  end if;

  case p_key
    when 'name' then
      if v is null then raise exception 'The brief needs a name.' using errcode = '22023'; end if;
      update xano_mirror.briefs set name = v where id = p_brief_id;
    when 'brief_type' then
      if v is not null and v not in ('Library', 'Composition', 'Commercial') then
        raise exception 'Library, Composition or Commercial.' using errcode = '22023';
      end if;
      update xano_mirror.briefs set brief_type = v where id = p_brief_id;
    when 'vocal_or_instrumental' then
      if v is not null and v not in ('Vocal', 'Instrumental', 'Either') then
        raise exception 'Vocal, Instrumental or Either.' using errcode = '22023';
      end if;
      update xano_mirror.briefs set vocal_or_instrumental = v where id = p_brief_id;
    when 'client_deadline' then
      begin
        update xano_mirror.briefs set client_deadline = v::date where id = p_brief_id;
      exception when others then
        raise exception 'Use a date like 20/09/2026.' using errcode = '22023';
      end;
    when 'budget_note' then update xano_mirror.briefs set client_budget_note = v where id = p_brief_id;
    when 'one_sentence' then update xano_mirror.briefs set one_sentence_brief = v where id = p_brief_id;
    when 'inspo' then update xano_mirror.briefs set idea_inspo = v where id = p_brief_id;
    when 'genres' then update xano_mirror.briefs set styles_and_genres = v where id = p_brief_id;
    when 'audience' then update xano_mirror.briefs set target_audience = v where id = p_brief_id;
    when 'feel' then update xano_mirror.briefs set audience_to_feel = v where id = p_brief_id;
    when 'geography' then update xano_mirror.briefs set geography_or_time = v where id = p_brief_id;
    when 'off_limits' then update xano_mirror.briefs set off_limits = v where id = p_brief_id;
    when 'story' then update xano_mirror.briefs set story_or_accents = v where id = p_brief_id;
    when 'reference_tracks' then update xano_mirror.briefs set reference_tracks = v where id = p_brief_id;
    when 'ref_comments' then update xano_mirror.briefs set ref_comments = v where id = p_brief_id;
    when 'lyrical_themes' then update xano_mirror.briefs set lyrical_themes = v where id = p_brief_id;
    when 'anything_else' then update xano_mirror.briefs set anything_else = v where id = p_brief_id;
    else
      raise exception 'Unknown brief field: %', p_key using errcode = '22023';
  end case;
end
$function$;

revoke all on function public.track_update_brief(bigint, text, text) from public, anon;
grant execute on function public.track_update_brief(bigint, text, text) to authenticated;
