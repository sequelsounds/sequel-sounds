-- 0050_release_form_client_picker
--
-- The Send to picker on the release form modal.
--
-- The address is assembled HERE, not in the page: street, city, postcode and
-- the country's name, one per line, empties dropped. The form prints it line
-- for line, so the lines are decided once, in SQL.
--
-- ⚠️ Only 37 of the 97 live clients have a street address on file, and 32 a
-- postcode. A thin address is normal and the box stays editable — this fills
-- what is known, it does not vouch for it.
--
-- ⚠️ THE PICKER DOES NOT BIND THE FORM TO A CLIENT. It fills two text boxes and
-- then has nothing more to do with it. A release form goes to a broadcaster,
-- which is often not the client on the project and sometimes not a client at
-- all, so a typed name that matches nobody is a perfectly good answer and is
-- what gets printed.
create or replace function public.track_clients_for_picker()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $function$
declare v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'company'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', c.id,
             'company', c.company,
             'address', nullif(
               concat_ws(
                 chr(10),
                 nullif(btrim(coalesce(c.street_address, '')), ''),
                 nullif(btrim(coalesce(c.city, '')), ''),
                 nullif(btrim(coalesce(c.postal_code, '')), ''),
                 nullif(btrim(coalesce(cl.country, '')), '')
               ), '')) as x
    from xano_mirror.clients c
    left join xano_mirror.countries_list cl on cl.id = c.country
    where coalesce(c.status, '') <> 'Archived'
      and nullif(btrim(coalesce(c.company, '')), '') is not null
  ) s;
  return v;
end
$function$;

revoke all on function public.track_clients_for_picker() from public, anon;
grant execute on function public.track_clients_for_picker() to authenticated;
