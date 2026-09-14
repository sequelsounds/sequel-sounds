-- xano_mirror.user_directory — Track's get_users (414) and get_user_by_uuid.
--
-- One view for both pages. The list endpoint filters staff out and the
-- by-uuid endpoint does not, so the filter lives in the list hook rather than
-- here, which is also where Track puts it.
--
-- country_title is the CLIENT's country, reached through the user's company —
-- user → Clients.Country → Countries List. There is no country column on the
-- user.
--
-- The lookups are LEFT joins, as in Xano: a user with no company still appears,
-- with a blank company and country. Several do.
create or replace view xano_mirror.user_directory
with (security_invoker = true) as
select
  u.id,
  u.uuid,
  u.name,
  u.email,
  u.job_title,
  u.phone_number,
  u.created_at,
  u.notes,
  -- ⚠️ user_type 1 is Admin and 2 is Sequel. get_users excludes both, so
  -- /users lists only external people. A new internal type has to be excluded
  -- there too or it starts appearing in a client-facing list.
  u.user_type,
  ut.user_type as user_type_title,
  u.status,
  us.status as status_title,
  u.company,
  c.company as company_name,
  c.uuid as company_uuid,
  co.country as country_title
from xano_mirror."user" u
left join xano_mirror.user_types ut on ut.id = u.user_type
left join xano_mirror.user_statuses us on us.id = u.status
left join xano_mirror.clients c on c.id = u.company
left join xano_mirror.countries_list co on co.id = c.country;

grant select on xano_mirror.user_directory to authenticated;
