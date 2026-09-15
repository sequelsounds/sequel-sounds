-- 15 Sep 2026. Archiving a supplier — Andy: archive, not delete.
--
-- Neither app could do this. The old app draws an archive mark on the Partners
-- and Roster rows (delete_Partner_button) with nothing behind it, and
-- Supplier List has no status column, so there was nothing to set. It is safe
-- to add one here because supplier_list left the sync on 13 Sep: Supabase is
-- the original, and no push will overwrite it.
--
-- What archived means (Andy, 15 Sep):
--   - the supplier leaves the Partners and Roster lists and every supplier
--     picker;
--   - invoice and contract lines that already point at it keep showing its
--     name — nothing that joins supplier_list filters on status;
--   - its own page still opens by link.
alter table xano_mirror.supplier_list
  add column if not exists status text not null default 'Active';

alter table xano_mirror.supplier_list
  drop constraint if exists supplier_list_status_chk;
alter table xano_mirror.supplier_list
  add constraint supplier_list_status_chk check (status in ('Active', 'Archived'));

-- Appended at the END: create or replace view cannot reorder columns. The
-- lists filter on it; the views stay unfiltered so a supplier page opens.
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
    s.status
   FROM ((xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON ((co.id = s.countries_list_id)))
     LEFT JOIN xano_mirror.regions r ON ((r.id = s.regions_id)))
  WHERE (s.supplier_type IS DISTINCT FROM 'Composition Team'::text);

create or replace view xano_mirror.roster_list as
 SELECT s.id,
    s.uuid,
    s.title,
    s.supplier_type,
    s.briefing_list,
    s.approved,
    s.strengths,
    s.brief_email,
    s.finance_email,
    s.website,
    s.phone_number,
    s.city,
    s.bio,
    s.studio_setup,
    s.stand_out_work,
    s.composition_showreel,
    s.sounddesign_showreel,
    s.final_mix_showreel,
    s.library_link,
    s.access_to_vocalist,
    s.sound_design,
    s.final_mix,
    s.composer_library,
    s.ca_status,
    s.qbo_vendor_id,
    s.countries_list_id AS country_id,
    co.country AS country_text,
    s.regions_id AS region_id,
    r.region AS region_text,
    s.status
   FROM ((xano_mirror.supplier_list s
     LEFT JOIN xano_mirror.countries_list co ON ((co.id = s.countries_list_id)))
     LEFT JOIN xano_mirror.regions r ON ((r.id = s.regions_id)))
  WHERE (s.supplier_type = 'Composition Team'::text);

create or replace function public.track_archive_supplier(p_supplier_id bigint)
returns void
language plpgsql
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can archive a supplier.' using errcode = '42501';
  end if;

  update xano_mirror.supplier_list s
     set status = 'Archived'
   where s.id = p_supplier_id;

  if not found then
    raise exception 'Supplier not found.' using errcode = 'P0002';
  end if;
end
$function$;

revoke all on function public.track_archive_supplier(bigint) from public, anon;
grant execute on function public.track_archive_supplier(bigint) to authenticated;
