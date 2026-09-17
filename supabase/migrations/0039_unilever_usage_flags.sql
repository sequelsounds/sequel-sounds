-- Usage flags only where there is usage — 17 Sep 2026.
--
-- Andy: "most of these aren't supposed to have any territories or usage region
-- on them because there is no usage" — a search-only or demos-only invoice
-- licenses nothing, so a blank territory and region are correct, not missing.
--
-- So the two usage flags now carry the same condition the song flag already
-- had: licence money on the invoice (master + publishing + the Sequel licence
-- fee). On 2026 that takes territories from 52 flags to 14 and region from 54
-- to 17. NOTHING ELSE CHANGES — the report's own figures and every exported
-- column are untouched; this is only what the page calls missing.
--
-- The whole function is restated because that is how `create or replace`
-- works; diff it against 0038 and the two `case` arms are the only change.

create or replace function public.track_unilever_report(p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'xano_mirror', 'public', 'pg_catalog'
as $function$
declare
  v_rows  jsonb;
  v_years jsonb;
begin
  if not public.track_is_finance() then
    raise exception 'The Unilever report is for finance only.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb) into v_years
  from (
    select distinct extract(year from i.invoice_date)::int as y
    from invoices i
    join project_master_list p on p.id = i.project_master_list_id
    where i.invoice_date is not null
      and i.status is distinct from 'Archived'
      and p.brand_group is distinct from 'Non-Unilever'
  ) ys;

  with lines as (
    select
      li.invoice_id,
      sum(li.fee_amount) filter (where li.category = 'Demos')          as demo_tp,
      count(*) filter (where li.category = 'Demos'
                         and li.fee_type is distinct from 'studios')   as demo_n,
      sum(li.fee_amount) filter (where li.category = 'Searches')       as search_tp,
      count(*) filter (where li.category = 'Searches'
                         and li.fee_type is distinct from 'studios')   as search_n,
      sum(li.fee_amount) filter (where li.category = 'Library Master') as master_tp,
      sum(li.fee_amount) filter (where li.category = 'Publishing')     as pub_tp,
      count(*) filter (where li.category in ('Library Master', 'Publishing')
                         and li.fee_type is distinct from 'studios')   as pub_n,
      sum(li.fee_amount) filter (where li.category = 'Other Fees')     as other_tp
    from invoice_line_items li
    group by li.invoice_id
  ),
  base as (
    select
      i.id, i.uuid, i.invoice_date, i.description, i.usage_territories,
      i.usage_region, i.invoice_number, i.song_name, i.artist_name,
      i.demo_cost_avoidance, i.search_cost_avoidance, i.other_cost_avoidance,
      i.sequel_demo_fee, i.sequel_search_fee, i.sequel_consultancy_fee,
      coalesce(i.gross_spend, 0)            as gross_spend,
      coalesce(i.total_to_invoice, 0)       as total_to_invoice,
      coalesce(i.total_third_party_fees, 0) as total_third_party_fees,
      coalesce(i.total_service_fees, 0)     as total_service_fees,
      c.currency       as cur,
      cl.company       as invoicee_name,
      r.id             as region_id,
      r.region         as region_text,
      p.sequel_no      as job_no,
      p.brand          as p_brand,
      p.brand_group    as p_brand_group,
      p.country        as p_country,
      p.brand_no       as p_adpro,
      p.extension_yn   as p_extension,
      p.project_type   as p_type,
      coalesce(l.demo_tp, 0)   as demo_tp,
      coalesce(l.demo_n, 0) + case when i.demo_contingency_fee > 0 then 1 else 0 end     as demo_count,
      coalesce(l.search_tp, 0) as search_tp,
      coalesce(l.search_n, 0) + case when i.search_contingency_fee > 0 then 1 else 0 end as search_count,
      coalesce(l.master_tp, 0) + coalesce(i.master_sequel_studios_fee, 0)    as master_total,
      coalesce(l.pub_tp, 0) + coalesce(i.publishing_sequel_studios_fee, 0)   as pub_total,
      coalesce(l.pub_n, 0) + case when i.license_contingency_fee > 0 then 1 else 0 end   as pub_count,
      coalesce(l.other_tp, 0)  as other_tp,
      coalesce(i.master_sequel_licence_fee, 0) + coalesce(i.publishing_sequel_licence_fee, 0) as licence_service,
      coalesce(i.master_cost_avoidance, 0) + coalesce(i.publishing_cost_avoidance, 0)       as licence_ca,
      coalesce(i.demo_cost_avoidance, 0) + coalesce(i.search_cost_avoidance, 0)
        + coalesce(i.master_cost_avoidance, 0) + coalesce(i.publishing_cost_avoidance, 0)
        + coalesce(i.other_cost_avoidance, 0)                                               as total_ca,
      coalesce(i.eur_rate, 0) as rate
    from invoices i
    -- Inner, as Xano: an invoice with no project is not a Unilever job.
    join project_master_list p on p.id = i.project_master_list_id
    left join currencies_bank_accounts c on c.id = i.currency_id
    left join clients cl on cl.id = i.client_id
    left join regions r on r.id = cl.region
    left join lines l on l.invoice_id = i.id
    where i.invoice_date >= make_date(p_year, 1, 1)
      and i.invoice_date <= make_date(p_year, 12, 31)
      and i.status is distinct from 'Archived'
      and p.brand_group is distinct from 'Non-Unilever'
  )
  select coalesce(jsonb_agg(rr.row order by rr.d, rr.id), '[]'::jsonb)
  into v_rows
  from (
    select b.invoice_date as d, b.id, jsonb_build_object(
      'id', b.id,
      'uuid', b.uuid,
      'date', b.invoice_date,
      'business_group', b.p_brand_group,
      'category', b.p_brand_group,
      'brand_position', '',
      'brand', b.p_brand,
      'memo', b.description,
      'type', b.p_type,
      'country_logged', b.p_country,
      'usage_territories', b.usage_territories,
      'usage_region', b.usage_region,
      'adpro_number', b.p_adpro,
      'total_cost_eur', b.gross_spend * b.rate,
      'total_fees_eur', b.total_to_invoice * b.rate,
      'total_third_party_fees_eur', b.total_third_party_fees * b.rate,
      'total_service_fees_eur', b.total_service_fees * b.rate,
      'total_cost_avoidance_eur', b.total_ca * b.rate,
      'extension', b.p_extension,
      'invoice_number', b.invoice_number,
      'date_of_invoice', b.invoice_date,
      'service_job_no', b.job_no,
      'invoicee', b.invoicee_name,
      'currency', b.cur,
      'rate', b.rate,
      'demo_third_party_local', b.demo_tp,
      'demo_supplier_count', b.demo_count,
      'demo_cost_avoidance_local', b.demo_cost_avoidance,
      'demo_service_fees_local', b.sequel_demo_fee,
      'search_third_party_local', b.search_tp,
      'search_supplier_count', b.search_count,
      'search_cost_avoidance_local', b.search_cost_avoidance,
      'search_service_fees_local', b.sequel_search_fee,
      -- The invoice's own track and nothing else (Andy, 9 Sep).
      'artist_composer', b.artist_name,
      'song', b.song_name,
      'initial_cost_master_pub_local', b.master_total + b.pub_total + b.licence_ca,
      'total_master_fee_local', b.master_total,
      'total_publishing_fee_local', b.pub_total,
      'licence_third_party_local', b.master_total + b.pub_total,
      'publisher_supplier_count', b.pub_count,
      'licence_cost_avoidance_local', b.licence_ca,
      'licence_service_fees_local', b.licence_service,
      'other_third_party_local', b.other_tp,
      'other_cost_avoidance_local', b.other_cost_avoidance,
      'other_service_fees_local', b.sequel_consultancy_fee,
      '_region_id', b.region_id,
      '_region_text', b.region_text,
      'issues', to_jsonb(array_remove(array[
        case when nullif(btrim(b.invoice_number), '') is null then 'No invoice number' end,
        case when b.rate <= 0 then 'No EUR rate' end,
        case when b.region_id is null then 'Invoiced client has no region' end,
        case when b.cur is null then 'No currency' end,
        case when nullif(btrim(b.p_adpro), '') is null
               or lower(btrim(b.p_adpro)) in ('na', 'n/a', 'tbc', 'testing only', 'no admanager number')
             then 'No AdPro number' end,
        case when (b.master_total + b.pub_total + b.licence_service) > 0
                  and nullif(btrim(b.usage_region), '') is null then 'No usage region' end,
        case when (b.master_total + b.pub_total + b.licence_service) > 0
                  and nullif(btrim(b.usage_territories), '') is null then 'No usage territories' end,
        case when nullif(btrim(b.job_no), '') is null then 'No job number' end,
        case when nullif(btrim(b.p_type), '') is null then 'No project type' end,
        case when nullif(btrim(b.p_brand), '') is null then 'No brand' end,
        case when (b.master_total + b.pub_total + b.licence_service) > 0
                  and nullif(btrim(b.song_name), '') is null
             then 'Licence with no song' end
      ], null::text))
    ) as row
    from base b
  ) rr;

  return jsonb_build_object('year', p_year, 'years', v_years,
                            'count', jsonb_array_length(v_rows), 'rows', v_rows);
end
$function$;

revoke all on function public.track_unilever_report(int) from public, anon;
grant execute on function public.track_unilever_report(int) to authenticated;
