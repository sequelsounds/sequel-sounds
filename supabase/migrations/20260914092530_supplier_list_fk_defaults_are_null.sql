-- `countries_list_id`, `regions_id` and `default_currency_id` each defaulted to
-- `0`, and each has a real foreign key. No lookup table has a row 0, so every
-- insert that omitted a country failed with a foreign key violation — the first
-- create attempt did exactly that.
--
-- The `0` is Xano's convention, not Postgres': in Xano an integer FK is
-- non-nullable and defaults to 0, so 0 IS "unset" ("Made By Mistry" had
-- regions_id 0, which is why the partners tabs once summed to 92 of 93). The
-- mirror faithfully copied the default and then added a real FK on top of it,
-- which is a combination that can only work as long as nothing ever inserts.
--
-- Now that this table is the original and does accept inserts, unset is null.
-- No existing row changes: none of the three holds a 0 today.
alter table xano_mirror.supplier_list
  alter column countries_list_id drop default,
  alter column regions_id drop default,
  alter column default_currency_id drop default;

comment on column xano_mirror.supplier_list.countries_list_id is
  'Unset is NULL here, not 0. Xano uses 0 for an unset integer FK; this table has a real foreign key, and no country has id 0.';
