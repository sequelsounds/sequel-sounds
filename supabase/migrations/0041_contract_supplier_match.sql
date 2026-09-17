-- Matching a contract's supplier — 17 Sep 2026.
--
-- ⚠️ THE MODEL NEVER CHOOSES. It returns every rights-holder name printed on
-- the document; this function does the lookup. The old app asked the model
-- which of 92 companies appeared on the page and got "Universal Music UK" on a
-- Warner licence — while correctly reporting the printed name as WARNER MUSIC
-- UK LIMITED. It was matching silhouettes, not identities, and nothing
-- downstream could tell a confident wrong answer from a right one.
--
-- Same components, different failure mode: a model reading a name off a page
-- with code doing the lookup can only ever produce NO match.
--
-- Country is a TIE-BREAK, NOT A FILTER. The Supplier List holds the same
-- company several times for different territories (two Warner Chappell rows,
-- Warner Music UK and Warner Music Group USA), so name alone cannot separate
-- them — but an MCPS licence prints no rights-holder address at all, so
-- filtering on country would lose the match entirely.
--
-- ⚠️ Supplier_Type is NOT used: it is backwards on the Warner rows (Warner
-- Music typed Publisher, Warner Chappell typed Label). It would need cleaning
-- before it could be a second tie-break.

-- Punctuation apart: "RESERVOIR MEDIA MANAGEMENT, INC." and our
-- "Reservoir Media Management Inc." are the same company, and a raw substring
-- match misses it over one comma.
create or replace function public.track_supplier_norm(p_text text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
$function$;

create or replace function public.track_match_supplier(p_names text[], p_country text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_hay      text;
  v_country  text := nullif(btrim(lower(coalesce(p_country, ''))), '');
  v_country_id bigint;
  v_best     record;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can do that.' using errcode = '42501';
  end if;

  -- Every printed name in one haystack: the imprint may be absent from our
  -- list where the parent is present (contract 87), and an agency name the
  -- model leaks in cannot match anything, because agencies are not suppliers.
  v_hay := public.track_supplier_norm(array_to_string(p_names, ' | '));
  if v_hay = '' then
    return jsonb_build_object('supplier_id', null, 'supplier', null,
                              'country_matched', false, 'reason', 'no names printed');
  end if;

  if v_country is not null then
    select cl.id into v_country_id
      from xano_mirror.countries_list cl
     where lower(btrim(cl.country)) = v_country
        or (v_country in ('uk', 'u.k.', 'united kingdom', 'england', 'scotland', 'wales', 'great britain')
            and lower(btrim(cl.country)) in ('uk', 'united kingdom'))
        or (v_country in ('usa', 'u.s.a.', 'us', 'united states', 'united states of america')
            and lower(btrim(cl.country)) in ('usa', 'united states'))
     limit 1;
  end if;

  -- Longest name wins, so "Warner Music Group" beats "Warner Music" where both
  -- are printed; the country hit outranks length.
  select s.id, s.title,
         (v_country_id is not null and s.countries_list_id = v_country_id) as country_hit
    into v_best
    from xano_mirror.supplier_list s
   where length(public.track_supplier_norm(s.title)) >= 4
     and position(public.track_supplier_norm(s.title) in v_hay) > 0
   order by (v_country_id is not null and s.countries_list_id = v_country_id) desc,
            length(public.track_supplier_norm(s.title)) desc
   limit 1;

  if v_best.id is null then
    return jsonb_build_object('supplier_id', null, 'supplier', null,
                              'country_matched', false, 'reason', 'no supplier on the list matched a printed name');
  end if;

  return jsonb_build_object('supplier_id', v_best.id, 'supplier', v_best.title,
                            'country_matched', coalesce(v_best.country_hit, false), 'reason', null);
end
$function$;

revoke all on function public.track_supplier_norm(text) from public, anon;
revoke all on function public.track_match_supplier(text[], text) from public, anon;
grant execute on function public.track_supplier_norm(text) to authenticated;
grant execute on function public.track_match_supplier(text[], text) to authenticated;
