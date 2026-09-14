-- xano_mirror.client_list — Track's get_clients_list (api 554), recreated.
--
-- security_invoker so it inherits the RLS on xano_mirror.clients: staff see
-- every client, a client user sees only their own company.
--
-- Three points of fidelity, each taken from the rendered page rather than
-- assumed:
--
-- 1. The archive filter is `is distinct from 'Archived'`, not `= 'Active'`.
--    A row with a null or blank status still appears — Xano's own choice,
--    kept, so a client created outside the normal path is not lost.
-- 2. `collate "C"` on the sort. Xano orders by byte, so digits come first and
--    a lowercase initial sorts after every uppercase one: the list runs
--    "11:11 …", "360FX Milan", … "Weber Shandwick New York",
--    "adam&eve\TBWA London". Postgres' default collation would put adam&eve
--    third. Verified against Track's own first four and last three rows.
-- 3. The joins are left joins. All 96 live clients currently carry a country,
--    a region and a client type, so this is indistinguishable from Xano's
--    behaviour today; if Xano's joins turn out to be inner, a client created
--    without one of the three would show here and not in Track.
create or replace view xano_mirror.client_list
with (security_invoker = true) as
select
  c.id,
  c.uuid,
  c.company,
  c.city,
  c.street_address,
  c.postal_code,
  c.invoice_email,
  c.accounts_payable_email,
  c.qbo_customer_id,
  c.invoice_instructions,
  c.status,
  c.country      as country_id,
  co.country     as country_text,
  c.region       as region_id,
  r.region       as region_text,
  c.client_type  as client_type_id,
  ct.client_type as client_type_text
from xano_mirror.clients c
left join xano_mirror.countries_list co on co.id = c.country
left join xano_mirror.regions r on r.id = c.region
left join xano_mirror.client_types ct on ct.id = c.client_type
where c.status is distinct from 'Archived';

grant select on xano_mirror.client_list to authenticated;
