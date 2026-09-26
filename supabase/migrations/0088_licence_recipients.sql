-- 0088 — licence opens and downloads, by recipient (Andy, 26 Sep: "can we also
-- record that a licence has been downloaded … and by whom").
--
-- ⚠️ ONE SENT LINK PER RECIPIENT. Until now a licence had a single 'sent' link
-- whoever it went to, so an open could only be pinned on the last address it
-- was sent to. Each address now gets its own link, and an open or download is
-- put against the address that link went to.
--
-- ⚠️ STILL "WHICH LINK", NOT "WHICH PERSON". A forwarded email carries the
-- recipient's link. Clients do not log in to open a licence, so this is the
-- best that can be known without asking them to.
--
-- Downloads: the email's single VIEW LICENCE button now opens a dedicated
-- licence page (/licence?id=…: the terms, the document, DOWNLOAD) instead of
-- the bare PDF, and DOWNLOAD there is logged as a download. Andy, 26 Sep: one
-- button in the email; not the asset page, and not styled like it.

alter table public.share_links add column if not exists recipient text;

drop function if exists public.track_licence_send_link(uuid);

create or replace function public.track_licence_send_link(p_uuid uuid, p_to text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text;
  v_to   text := nullif(lower(btrim(coalesce(p_to, ''))), '');
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can send licences.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.track_composition_licences r
                  where r.uuid = p_uuid and r.status is distinct from 'Archived') then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
  select s.code into v_code
    from public.share_links s
   where s.licence_uuid = p_uuid and s.purpose = 'sent'
     and s.recipient is not distinct from v_to
   order by s.created_at
   limit 1;
  if v_code is null then
    v_code := public.share_code();
    insert into public.share_links (code, licence_uuid, created_by, expires_at, purpose, recipient)
    values (v_code, p_uuid, public.track_user_id(), null, 'sent', v_to);
  end if;
  return jsonb_build_object('code', v_code);
end
$function$;
revoke all on function public.track_licence_send_link(uuid, text) from public, anon;
grant execute on function public.track_licence_send_link(uuid, text) to authenticated;

/* The notification names the address the opened link was sent to. Still once
 * per kind per licence (track_notifications_once_idx): the first open and the
 * first download. The menu line has the full picture. */
create or replace function public.track_notify_share_event(p_code text, p_event text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_link    public.share_links;
  v_form    public.track_release_forms;
  v_lic     public.track_composition_licences;
  v_kind    text;
  v_what    text;
begin
  select * into v_link from public.share_links s where s.code = p_code;
  if not found or v_link.created_by is null then
    return;
  end if;
  if v_link.purpose is distinct from 'sent' then
    return;
  end if;
  v_what := case when p_event = 'download' then 'downloaded' else 'opened' end;

  if v_link.licence_uuid is not null then
    select * into v_lic from public.track_composition_licences r where r.uuid = v_link.licence_uuid;
    if not found then
      return;
    end if;
    insert into public.track_notifications
      (user_id, kind, message, project_id, subject_kind, subject_uuid)
    values (
      v_link.created_by,
      case when p_event = 'download' then 'licence_downloaded' else 'licence_viewed' end,
      format('%s %s the licence for %s.',
             coalesce(nullif(btrim(coalesce(v_link.recipient, '')), ''),
                      nullif(btrim(coalesce(v_lic.sent_to, '')), ''), 'Someone'),
             v_what,
             coalesce(nullif(btrim(coalesce(v_lic.composition_title, '')), ''), 'a composition')),
      v_lic.project_master_list_id,
      'licence',
      v_lic.uuid)
    on conflict do nothing;
    return;
  end if;

  if v_link.release_form_uuid is null then
    return;
  end if;
  select * into v_form from public.track_release_forms r where r.uuid = v_link.release_form_uuid;
  if not found then
    return;
  end if;
  v_kind := case when p_event = 'download' then 'release_form_downloaded'
                 else 'release_form_viewed' end;
  insert into public.track_notifications
    (user_id, kind, message, project_id, subject_kind, subject_uuid)
  values (
    v_link.created_by,
    v_kind,
    format('%s %s the release form for %s.',
           coalesce(nullif(btrim(coalesce(v_form.recipient_name, '')), ''), 'Someone'),
           v_what,
           coalesce(nullif(btrim(coalesce(v_form.track_name, '')), ''), 'a track')),
    v_form.project_master_list_id,
    'release_form',
    v_form.uuid)
  on conflict do nothing;
end
$function$;

/* The menu's activity: totals as before, plus one entry per address it was
 * sent to. A link made before 0088 has no recipient and falls back to sent_to. */
create or replace function public.track_licence_activity(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_sent_at timestamptz;
  v_sent_to text;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select r.sent_at, r.sent_to into v_sent_at, v_sent_to
    from public.track_composition_licences r where r.uuid = p_uuid;
  return (
    with links as (
      select s.code, s.created_at,
             coalesce(s.recipient, lower(v_sent_to), 'unknown') as recipient
        from public.share_links s
       where s.licence_uuid = p_uuid and s.purpose = 'sent'
    ),
    per as (
      select l.recipient, min(l.created_at) as sent_at,
             count(e.id) filter (where e.event = 'view')     as views,
             count(e.id) filter (where e.event = 'download') as downloads,
             max(e.created_at) filter (where e.event = 'view')     as last_view,
             max(e.created_at) filter (where e.event = 'download') as last_download
        from links l
        left join public.track_share_events e on e.code = l.code
       group by l.recipient
    )
    select jsonb_build_object(
      'sent_at', v_sent_at,
      'sent_to', v_sent_to,
      'views', coalesce(sum(p.views), 0),
      'downloads', coalesce(sum(p.downloads), 0),
      'last_view', max(p.last_view),
      'last_download', max(p.last_download),
      'recipients', coalesce(jsonb_agg(jsonb_build_object(
          'to', p.recipient, 'sent_at', p.sent_at, 'views', p.views,
          'downloads', p.downloads, 'last_view', p.last_view,
          'last_download', p.last_download) order by p.sent_at), '[]'::jsonb))
      from per p);
end
$function$;
revoke all on function public.track_licence_activity(uuid) from public, anon;
grant execute on function public.track_licence_activity(uuid) to authenticated;

/* The licence page (/licence?id=…) shows the terms beside the document. They
 * come back with the link itself, so the page makes one call, rate-limited and
 * logged like every other share. Only what is printed on the certificate. */
CREATE OR REPLACE FUNCTION public.resolve_share_link(p_code text, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'xano_mirror', 'public', 'pg_catalog'
AS $function$
declare
  v_link public.share_links;
  v_asset xano_mirror.project_assets;
  v_contract xano_mirror.contracts;
  v_release public.track_release_forms;
  v_licence public.track_composition_licences;
  v_key text := 'share_read_' || coalesce(nullif(p_ip, ''), 'unknown');
  v_row public.rate_limits;
begin
  insert into public.rate_limits (limit_key, hits, window_start) values (v_key, 0, now())
  on conflict (limit_key) do nothing;
  select * into v_row from public.rate_limits where limit_key = v_key for update;
  if v_row.window_start + interval '5 minutes' < now() then
    update public.rate_limits set hits = 1, window_start = now() where limit_key = v_key;
  elsif v_row.hits >= 30 then
    return jsonb_build_object('error', 'busy');
  else
    update public.rate_limits set hits = hits + 1 where limit_key = v_key;
  end if;
  select * into v_link from public.share_links s where s.code = btrim(coalesce(p_code, ''));
  if not found then
    return jsonb_build_object('error', 'invalid');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('error', 'expired');
  end if;
  if v_link.licence_uuid is not null then
    select * into v_licence from public.track_composition_licences r where r.uuid = v_link.licence_uuid;
    if not found or coalesce(v_licence.aws_path, '') = ''
       or v_licence.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'licence', 'key', v_licence.aws_path, 'file_name', v_licence.file_name,
      'file_type', 'application/pdf', 'file_size', null, 'expires_at', v_link.expires_at,
      'details', jsonb_build_object(
        'sequel_no', v_licence.sequel_no,
        'issued_on', v_licence.issued_on,
        'invoice_number', v_licence.invoice_number,
        'licensee_name', v_licence.licensee_name,
        'composition_title', v_licence.composition_title,
        'writer_names', v_licence.writer_names,
        'rights_granted', v_licence.rights_granted,
        'licensor_share', v_licence.licensor_share,
        'production_name', v_licence.production_name,
        'client_name', v_licence.client_name,
        'brand', v_licence.brand,
        'campaign', v_licence.campaign,
        'scripts', v_licence.scripts,
        'cutdowns', v_licence.cutdowns,
        'media', v_licence.media,
        'territory', v_licence.territory,
        'term', v_licence.term,
        'first_transmission', v_licence.first_transmission,
        'licence_fee', v_licence.licence_fee));
  end if;
  if v_link.release_form_uuid is not null then
    select * into v_release from public.track_release_forms r where r.uuid = v_link.release_form_uuid;
    if not found or coalesce(v_release.aws_path, '') = ''
       or v_release.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'release_form', 'key', v_release.aws_path, 'file_name', v_release.file_name,
      'file_type', 'application/pdf', 'file_size', null, 'expires_at', v_link.expires_at);
  end if;
  if v_link.contract_uuid is not null then
    select * into v_contract from xano_mirror.contracts c where c.uuid = v_link.contract_uuid;
    if not found or coalesce(v_contract.aws_path, '') = ''
       or v_contract.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'contract', 'key', v_contract.aws_path, 'file_name', v_contract.file_name,
      'file_type', coalesce(nullif(v_contract.file_type, ''), 'application/pdf'),
      'file_size', v_contract.file_size, 'expires_at', v_link.expires_at);
  end if;
  select * into v_asset from xano_mirror.project_assets a where a.uuid = v_link.asset_uuid;
  if not found or coalesce(v_asset.aws_path, '') = '' then
    return jsonb_build_object('error', 'invalid');
  end if;
  return jsonb_build_object(
    'kind', 'asset', 'key', v_asset.aws_path, 'file_name', v_asset.file_name,
    'file_type', v_asset.file_type, 'file_size', v_asset.file_size,
    'expires_at', v_link.expires_at,
    'peaks', (select p.peaks from public.asset_peaks p where p.asset_uuid = v_asset.uuid));
end
$function$;


/* ------------------------------------------------ the licence fee
 * Andy, 26 Sep: the fee on a licence is read off the invoice's lines, not its
 * total — on 1167 ("Demo & Licence Fees", SGD 15,200) the total includes
 * SGD 4,200 of demos. AND IT FOLLOWS THE RIGHTS GRANTED: "a paythrough job for
 * a re-record … only want to issue a master licence and the fee is only for
 * the master as the publisher will be getting their fee and will be issuing
 * their own licence." So the two sides come back separately and the form adds
 * up the side(s) the licence grants.
 *
 *   master      the master studios fee, the licence contingency (never used,
 *               0 on every invoice 26 Sep, kept so it cannot vanish), and
 *               Library Master line items
 *   publishing  the publishing studios fee and Publishing line items
 *
 * ⚠️ SEQUEL'S OWN LICENCE FEE IS NOT PART OF IT. The master and publishing
 * "Sequel licence fee" (10% of the licence on Bisma) is our fee on top — the
 * estimate lists it separately and the client's licence fee is the 10,000
 * without it (Andy, 26 Sep). Out: both licence fee columns, sequel_fee rows
 * with fee_type 'licence', and the legacy 'Licence' category.
 *
 * Third-party lines count only when paid through us: a line the client pays
 * the owner directly is not on our invoice. Demos, searches, consultancy and
 * other contingency are in neither side.
 *
 * 1167, after its lines were corrected in Xano on 26 Sep (studios 2,000 +
 * 2,000, Sequel licence fee 500 + 500, demo contingency 2,300): master
 * 2,000 + 3,000 = 5,000, publishing 2,000 + 3,000 = 5,000 — the estimate. */
create or replace function public.track_invoice_licence_parts(p_invoice_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'currency', public.track_currency_code(i.currency_id),
    'master',
      coalesce(i.master_sequel_studios_fee, 0) + coalesce(i.license_contingency_fee, 0)
      + coalesce((select sum(li.fee_amount) from xano_mirror.invoice_line_items li
                   where li.invoice_id = i.id and li.category = 'Library Master'
                     and not (li.line_type = 'sequel_fee' and li.fee_type = 'licence')
                     and (li.line_type is distinct from 'third_party' or li.is_paythrough)), 0),
    'publishing',
      coalesce(i.publishing_sequel_studios_fee, 0)
      + coalesce((select sum(li.fee_amount) from xano_mirror.invoice_line_items li
                   where li.invoice_id = i.id and li.category = 'Publishing'
                     and not (li.line_type = 'sequel_fee' and li.fee_type = 'licence')
                     and (li.line_type is distinct from 'third_party' or li.is_paythrough)), 0))
    from xano_mirror.invoices i
   where i.id = p_invoice_id
$function$;
revoke all on function public.track_invoice_licence_parts(bigint) from public, anon, authenticated;

create or replace function public.track_licence_prefill(p_project_id bigint, p_invoice_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $function$
declare
  p xano_mirror.project_master_list%rowtype;
  i xano_mirror.invoices%rowtype;
  c xano_mirror.clients%rowtype;
  v_country text;
  v_air date;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into p from xano_mirror.project_master_list where id = p_project_id;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  select * into i from xano_mirror.invoices where id = p_invoice_id and project_master_list_id = p_project_id;
  if not found then
    raise exception 'That invoice is not on this project.' using errcode = 'P0002';
  end if;
  -- The licensee is whoever the invoice is addressed to; failing that, the
  -- project's agency.
  select * into c from xano_mirror.clients where id = coalesce(i.client_id, p.client_agency);
  select cl.country into v_country from xano_mirror.countries_list cl where cl.id = c.country;
  v_air := coalesce(p.confirmed_first_air_date, p.proposed_air_date);

  return jsonb_build_object(
    'licensee_name', coalesce(btrim(c.company), ''),
    'licensee_address', coalesce(concat_ws(chr(10),
        nullif(btrim(coalesce(c.street_address, '')), ''),
        nullif(btrim(coalesce(c.city, '')), ''),
        nullif(btrim(coalesce(c.postal_code, '')), ''),
        nullif(btrim(coalesce(v_country, '')), '')), ''),
    -- ⚠️ NOT A FEE (0088): the invoice's master and publishing parts. The form
    -- adds up whichever side(s) the rights granted cover — see
    -- track_invoice_licence_parts. licence_fee stays as the invoice total, which
    -- the form shows only as a hint.
    'fee_parts', public.track_invoice_licence_parts(i.id),
    'licence_fee', coalesce(public.track_currency_code(i.currency_id) || ' ', '')
                   || to_char(coalesce(i.total_to_invoice, 0), 'FM999,999,999,990.00'),
    'rights_granted', 'Master & Publishing',
    'licensor_share', '100%',
    'production_name', coalesce(btrim(p.title), ''),
    'client_name', case when p.client = 1 then 'Unilever' else '' end,
    'brand', coalesce(btrim(p.brand), ''),
    'campaign', coalesce(nullif(btrim(p.campaignname), ''), btrim(p.title), ''),
    'scripts', btrim(concat_ws(' x ',
        nullif(btrim(coalesce(p.scripts, '')), ''),
        nullif(btrim(coalesce(p.durations, '')), '') || '"')),
    'cutdowns', case when p.cutdowns then 'Yes' when p.cutdowns = false then 'No' else '' end,
    'media', coalesce(btrim(p.media), ''),
    'territory', coalesce(btrim(p.territory), ''),
    'term', coalesce(btrim(p.term), ''),
    'first_transmission', case when v_air is null then ''
                               else to_char(v_air, 'FMDD FMMonth YYYY') end,
    'composition_title', coalesce(nullif(btrim(i.song_name), ''), ''),
    'writer_names', ''
  );
end
$function$;

