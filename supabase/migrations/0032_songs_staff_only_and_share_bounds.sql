-- Two fixes to 0030, from a review the same night (16 Sep 2026).
--
-- 1. Songs become staff-only to read.
--    sequel_songs_scoped_read let any signed-in user who can see a project
--    read its songs — Xano's named-only project access, copied. Since 0030 a
--    song's uuid is the credential for confirming its writers and signing its
--    Schedule A, and the row also carries the Firma signing link and the
--    contract email. A client user on the project could have read those
--    straight off the API and signed as the composer.
--    No client-facing page reads songs (every page that does sits behind
--    RequireStaff), so nothing a client sees changes. sequel_song_writer and
--    sequel_writers were already staff-only.
--    ⚠️ Revisit if a client portal ever lists songs: give it a view without
--    uuid and the signing columns rather than reopening this policy.
drop policy if exists sequel_songs_scoped_read on xano_mirror.sequel_songs;
create policy sequel_songs_staff_read on xano_mirror.sequel_songs
  for select to authenticated
  using (public.track_is_staff());

-- 2. Share split must be above 0 and at most 100. The upper bound also
--    refuses 'NaN' and 'Infinity', which numeric accepts and which compare
--    greater than every number, so "> 0" alone let them through.
create or replace function public.song_confirm_details(p_uuid uuid, p_title text, p_writers jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_song  xano_mirror.sequel_songs;
  v_title text := nullif(btrim(p_title), '');
  w       jsonb;
  v_name  text;
  v_cae   text;
  v_share numeric;
  v_count integer := 0;
begin
  select * into v_song from xano_mirror.sequel_songs s where s.uuid = p_uuid for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_song.composer_reg_form_status is distinct from 'Pending' then
    return jsonb_build_object('error', 'already_submitted');
  end if;
  if v_title is null then
    return jsonb_build_object('error', 'Please enter a track title.');
  end if;
  if p_writers is null or jsonb_typeof(p_writers) <> 'array' or jsonb_array_length(p_writers) = 0 then
    return jsonb_build_object('error', 'Please enter a name and share split for every composer.');
  end if;
  if jsonb_array_length(p_writers) > 20 then
    return jsonb_build_object('error', 'That is more composers than a Schedule A can hold.');
  end if;

  for w in select * from jsonb_array_elements(p_writers) loop
    v_name := nullif(btrim(w ->> 'full_name'), '');
    begin
      v_share := (w ->> 'share_split')::numeric;
    exception when others then
      v_share := null;
    end;
    if v_name is null or v_share is null or not (v_share > 0 and v_share <= 100) then
      return jsonb_build_object('error', 'Please enter a name and share split for every composer.');
    end if;
  end loop;

  update xano_mirror.sequel_songs s set
    track_title              = v_title,
    composer_reg_form_status = 'Confirmed',
    confirmed_at             = now()
  where s.id = v_song.id;

  for w in select * from jsonb_array_elements(p_writers) loop
    v_name  := btrim(w ->> 'full_name');
    v_cae   := nullif(btrim(w ->> 'cae_number'), '');
    v_share := (w ->> 'share_split')::numeric;

    insert into xano_mirror.sequel_song_writer (song_id, full_name, cae_number, share_split, created_at)
    values (v_song.id::integer, v_name, coalesce(v_cae, ''), v_share, now());

    if v_cae is not null and not exists (
      select 1 from xano_mirror.sequel_writers x where lower(btrim(x.cae_number)) = lower(v_cae)
    ) then
      insert into xano_mirror.sequel_writers (cae_number, full_name, created_at)
      values (v_cae, v_name, now());
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'song_id', v_song.id, 'writers', v_count);
end
$function$;
revoke all on function public.song_confirm_details(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.song_confirm_details(uuid, text, jsonb) to service_role;
