-- The quote document, for the rebuild's /quotes/:uuid.
--
-- Mirrors Xano's get_quote_by_uuid (api 419) — the same joins and the same
-- fields — with two deliberate differences:
--
--   * NO server-side formatting. 419 divides by 100 and comma-separates before
--     the front end sees it. These views carry full precision and the page
--     rounds once for display, the rule the invoice page already follows.
--   * NOT public. 419 is auth = false because clients open the old app's page
--     from a shared link. Here the existing `quotes_scoped_read` policy already
--     lets the project's client contact, ad producer and supervisor see it, so
--     a signed-in client reaches their own quote without the document being
--     open to anyone holding a uuid. Whether a public share link is added on
--     top is still Andy's call.
--
-- ⚠️ security_invoker so both views inherit the base tables' RLS.

create view xano_mirror.quote_detail with (security_invoker = true) as
select
  q.id,
  q.uuid,
  q.id                       as quote_no,
  q.status,
  q.description,
  q.created_at,

  -- ⚠️ The QUOTE's service, not the project's. They can differ — a Commercial
  -- quote can sit on a Composition project — and every rule on this page keys
  -- off the quote's own. The project's is carried too, because 419 returns it.
  q.service                  as service_id,
  qs.service                 as quote_service,
  ps.service                 as project_service,

  q.quote_currency,
  cur.currency               as currency_code,
  cur.symbol                 as currency_symbol,
  q.local_grand_total,

  q.term,
  q.territory,
  q.media,
  q.mcps_territories,
  q.scripts,
  q.duration,
  q.cutdowns_includedyn,
  q.mcps_track_rate,
  q.online_worldwide,
  q.song_name,
  q.artist_name,
  q.tracks_quoted,

  q.project_master_list_id,
  p.brand,
  p.title                    as project_title,
  p.sequel_no,
  p.brand_no,
  p.product,

  qc.company                 as client_name,
  cu.name                    as username,
  cc.company                 as company,
  r.region,
  sup.name                   as music_supervisor
from xano_mirror.quotes q
  left join xano_mirror.project_master_list p on p.id = q.project_master_list_id
  left join xano_mirror.services ps           on ps.id = p.services_id
  left join xano_mirror.services qs           on qs.id = q.service
  left join xano_mirror."user" cu             on cu.id = p.client_user_id
  left join xano_mirror.clients cc            on cc.id = cu.company
  left join xano_mirror.regions r             on r.id = cc.region
  left join xano_mirror."user" sup            on sup.id = p.music_supervisor
  left join xano_mirror.clients qc            on qc.id = q.clients_id
  left join xano_mirror.currencies_bank_accounts cur on cur.id = q.quote_currency;

comment on view xano_mirror.quote_detail is
  'One quote plus its joined project, client, region and currency. Mirrors Xano api 419. Money in minor units, unformatted.';

-- The line items, with the section and order that group them on the document.
--
-- ⚠️ Master and Publishing BOTH map to the section "Licensing" — that is what
-- makes a commercial quote show two supplier rows under one heading.
create view xano_mirror.quote_lines with (security_invoker = true) as
select
  li.id,
  li.quote_id,
  li.category,
  fc.section,
  fc.sort_order,
  li.fee_type,
  li.fee_description,
  li.cost,
  li.quantity,
  s.service as service_name
from xano_mirror.quote_line_items li
  left join xano_mirror.fee_categories fc on fc.category = li.category
  left join xano_mirror.services s        on s.id = li.services_id;

comment on view xano_mirror.quote_lines is
  'Quote line items with their fee-category section and sort order. Money in minor units.';

-- ⚠️ Nothing grants select on a new view by default, and PostgREST answers a
-- missing grant with 42501 while react-query sits there retrying — which reads
-- like a slow query rather than a refusal.
grant select on xano_mirror.quote_detail to authenticated;
grant select on xano_mirror.quote_lines  to authenticated;

