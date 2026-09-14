-- xano_mirror.client_detail — Track's get_client_detail (api 580).
--
-- The same columns as client_list and deliberately a second view rather than
-- a reuse of it: get_clients_list drops archived clients and get_client_detail
-- does not, so on Track an archived client is gone from the list and still
-- opens by URL. One view for each endpoint keeps that true here.
--
-- ⚠️ The Xano column is `Clients.UUID`, uppercase, where `Supplier List.uuid`
-- is lowercase — the inconsistency that cost hours in August, because Xano
-- answers the wrong case with "Unsupported parameter reference - uuid", which
-- reads like a bad input value. The mirror lower-cases every column on the way
-- in, so the trap does not survive the crossing.
create or replace view xano_mirror.client_detail
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
left join xano_mirror.client_types ct on ct.id = c.client_type;

grant select on xano_mirror.client_detail to authenticated;
