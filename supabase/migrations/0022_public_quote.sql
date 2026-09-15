-- 15 Sep 2026. A shared quote link has to open for someone who is not signed
-- in — the old app's /quotation does, and Andy confirmed the new one should.
--
-- It did not: /quotes/:uuid read quote_detail and quote_lines straight from
-- xano_mirror, which a signed-out visitor has no access to at all ("permission
-- denied for schema xano_mirror"). Found by Andy in a private window, after
-- the share button had been built and tested only while signed in.
--
-- This hands out exactly one quote document — its header and its lines — to
-- whoever holds its uuid, and nothing else. Keyed by uuid, never id, so it
-- cannot be walked. All 147 quote uuids are distinct and none is null or the
-- all-zero uuid Xano uses as a blank. Returns jsonb rather than the views' row
-- types, because a signed-out caller cannot see types in xano_mirror either.
create or replace function public.public_quote(p_uuid text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_uuid   uuid;
  v_detail jsonb;
  v_lines  jsonb;
begin
  begin
    v_uuid := p_uuid::uuid;
  exception when others then
    return null;
  end;
  if v_uuid is null or v_uuid = '00000000-0000-0000-0000-000000000000'::uuid then
    return null;
  end if;

  select to_jsonb(d) into v_detail
    from xano_mirror.quote_detail d
   where d.uuid = v_uuid
   limit 1;
  if v_detail is null then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines
    from xano_mirror.quote_lines l
   where l.quote_id = (v_detail ->> 'id')::bigint;

  return jsonb_build_object('detail', v_detail, 'lines', v_lines);
end
$function$;

revoke all on function public.public_quote(text) from public;
grant execute on function public.public_quote(text) to anon, authenticated;
