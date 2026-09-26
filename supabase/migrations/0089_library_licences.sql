-- Library licences — Sequel → the client, for a library track Sequel
-- sub-licenses under its agreement with the library (Andy, 26 Sep 2026:
-- "we are the library"). claude/sequel-track-library-licence-handoff.md
--
-- ⚠️ SAME TABLE, SAME RPCs. A library licence is a composition licence row
-- with kind = 'library': the same invoice-first rule, the same share links,
-- sends, opens and downloads. Chosen at create, never changed.
--
-- What differs, all decided by Andy on 26 Sep:
--  1. THE FEE IS THE LIBRARY'S ONLY — paythrough third-party Library Master /
--     Publishing lines; Sequel's own fees are not in it (1171 Mozart → 8,242).
--  2. PAYTHROUGH ONLY. With no paythrough library line the client is paying
--     the library direct, and it is the library's licence to issue, not ours.
--  3. LICENSOR'S SHARE IS ALWAYS 100% — set here, whatever the form sends.

alter table public.track_composition_licences
  add column if not exists kind text not null default 'composition';
alter table public.track_composition_licences
  drop constraint if exists track_composition_licences_kind_check;
alter table public.track_composition_licences
  add constraint track_composition_licences_kind_check check (kind in ('composition', 'library'));

/* The library's side of an invoice: its paythrough third-party lines only. */
create or replace function public.track_invoice_library_parts(p_invoice_id bigint)
returns jsonb
language sql stable security definer
set search_path = public, xano_mirror, pg_catalog
as $$
  select jsonb_build_object(
    'currency', public.track_currency_code(i.currency_id),
    'master', coalesce((select sum(li.fee_amount) from xano_mirror.invoice_line_items li
                         where li.invoice_id = i.id and li.line_type = 'third_party'
                           and li.is_paythrough and li.category = 'Library Master'), 0),
    'publishing', coalesce((select sum(li.fee_amount) from xano_mirror.invoice_line_items li
                             where li.invoice_id = i.id and li.line_type = 'third_party'
                               and li.is_paythrough and li.category = 'Publishing'), 0))
    from xano_mirror.invoices i
   where i.id = p_invoice_id
$$;
revoke all on function public.track_invoice_library_parts(bigint) from public, anon, authenticated;

/* Raised invoices on the project, now saying whether each carries a library fee. */
create or replace function public.track_licence_invoices(p_project_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = public, xano_mirror, pg_catalog
as $$
declare v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
             'status', i.status, 'currency', public.track_currency_code(i.currency_id),
             'total', i.total_to_invoice, 'client', c.company,
             'licences', (select count(*) from public.track_composition_licences l
                           where l.invoice_id = i.id and l.status <> 'Archived'),
             'library_fee', exists (select 1 from xano_mirror.invoice_line_items li
                                     where li.invoice_id = i.id and li.line_type = 'third_party'
                                       and li.is_paythrough
                                       and li.category in ('Library Master', 'Publishing')
                                       and coalesce(li.fee_amount, 0) > 0)) as x
      from xano_mirror.invoices i
      left join xano_mirror.clients c on c.id = i.client_id
     where i.project_master_list_id = p_project_id
       and btrim(coalesce(i.invoice_number, '')) <> ''
       and i.status in ('Awaiting Payment', 'Paid')
  ) s;
  return v;
end
$$;

/* The prefill gains library_parts beside fee_parts; the form uses whichever
 * the kind needs. Everything else as 0088. */
create or replace function public.track_licence_prefill(p_project_id bigint, p_invoice_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = public, xano_mirror, pg_catalog
as $$
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
    'fee_parts', public.track_invoice_licence_parts(i.id),
    'library_parts', public.track_invoice_library_parts(i.id),
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
$$;

create or replace function public.track_composition_licence_detail(p_uuid uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare r public.track_composition_licences%rowtype;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.track_composition_licences where uuid = p_uuid;
  if not found then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'uuid', r.uuid, 'ref', public.track_ref('licence', r.id), 'kind', r.kind,
    'invoice_id', r.invoice_id, 'invoice_number', r.invoice_number, 'sequel_no', r.sequel_no,
    'issued_on', r.issued_on,
    'licensee_name', r.licensee_name, 'licensee_address', coalesce(r.licensee_address, ''),
    'rights_granted', r.rights_granted, 'licensor_share', r.licensor_share,
    'composition_title', r.composition_title, 'writer_names', r.writer_names,
    'production_name', r.production_name, 'client_name', r.client_name,
    'brand', r.brand, 'campaign', r.campaign, 'scripts', r.scripts, 'cutdowns', r.cutdowns,
    'media', r.media, 'territory', r.territory, 'term', r.term,
    'first_transmission', r.first_transmission, 'licence_fee', r.licence_fee,
    'status', r.status, 'created_at', r.created_at,
    'sent_at', r.sent_at, 'sent_to', r.sent_to, 'send_error', r.send_error);
end
$$;

create or replace function public.track_create_composition_licence(
  p_project_id bigint, p_invoice_id bigint, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, xano_mirror, pg_catalog
as $$
declare
  v_uuid uuid := gen_random_uuid();
  v_key  text;
  v_me   public.track_users%rowtype;
  p      xano_mirror.project_master_list%rowtype;
  i      xano_mirror.invoices%rowtype;
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v_kind text := coalesce(nullif(btrim(coalesce(p_fields->>'kind', '')), ''), 'composition');
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can create licences.' using errcode = '42501';
  end if;
  if v_kind not in ('composition', 'library') then
    raise exception 'Unknown licence kind.' using errcode = '22023';
  end if;
  select * into v_me from public.track_users where auth_user_id = auth.uid();
  select * into p from xano_mirror.project_master_list where id = p_project_id;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  select * into i from xano_mirror.invoices where id = p_invoice_id and project_master_list_id = p_project_id;
  if not found then
    raise exception 'That invoice is not on this project.' using errcode = 'P0002';
  end if;
  if btrim(coalesce(i.invoice_number, '')) = '' or i.status not in ('Awaiting Payment', 'Paid') then
    raise exception 'That invoice has not been raised yet. Raise the licence invoice first.' using errcode = '22023';
  end if;
  if btrim(coalesce(p.sequel_no, '')) = '' then
    raise exception 'This project has no Sequel No.' using errcode = '22023';
  end if;
  if v_kind = 'library' then
    -- ⚠️ PAYTHROUGH ONLY (Andy, 26 Sep).
    if not exists (select 1 from xano_mirror.invoice_line_items li
                    where li.invoice_id = i.id and li.line_type = 'third_party' and li.is_paythrough
                      and li.category in ('Library Master', 'Publishing')
                      and coalesce(li.fee_amount, 0) > 0) then
      raise exception 'That invoice has no paythrough library fee. When the client pays the library direct, the library issues the licence.'
        using errcode = '22023';
    end if;
    f := f || jsonb_build_object('licensor_share', '100%');
  end if;
  perform public.track_licence_check_fields(f);
  v_key := 'contracts/licences/' || v_uuid || '.pdf';
  insert into public.track_composition_licences
    (uuid, kind, project_master_list_id, invoice_id, invoice_number, sequel_no,
     licensee_name, licensee_address, rights_granted, licensor_share, composition_title,
     writer_names, production_name, client_name, brand, campaign, scripts, cutdowns,
     media, territory, term, first_transmission, licence_fee,
     issued_on, aws_path, file_name, created_by)
  values
    (v_uuid, v_kind, p_project_id, i.id, btrim(i.invoice_number), btrim(p.sequel_no),
     btrim(f->>'licensee_name'), nullif(btrim(coalesce(f->>'licensee_address', '')), ''),
     btrim(f->>'rights_granted'), btrim(f->>'licensor_share'), btrim(f->>'composition_title'),
     btrim(f->>'writer_names'), btrim(f->>'production_name'), btrim(f->>'client_name'),
     btrim(f->>'brand'), btrim(f->>'campaign'), btrim(f->>'scripts'), btrim(f->>'cutdowns'),
     btrim(f->>'media'), btrim(f->>'territory'), btrim(f->>'term'),
     btrim(f->>'first_transmission'), btrim(f->>'licence_fee'),
     v_today, v_key,
     case when v_kind = 'library' then 'Library Licence ' else 'Licence ' end
       || btrim(p.sequel_no) || ' ' || btrim(f->>'composition_title') || '.pdf',
     v_me.id);
  return public.track_composition_licence_detail(v_uuid) || jsonb_build_object('key', v_key);
end
$$;

create or replace function public.track_update_composition_licence(p_uuid uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_kind text;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select kind into v_kind from public.track_composition_licences where uuid = p_uuid;
  if v_kind = 'library' then
    f := f || jsonb_build_object('licensor_share', '100%');
  end if;
  perform public.track_licence_check_fields(f);
  update public.track_composition_licences set
    licensee_name = btrim(f->>'licensee_name'),
    licensee_address = nullif(btrim(coalesce(f->>'licensee_address', '')), ''),
    rights_granted = btrim(f->>'rights_granted'),
    licensor_share = btrim(f->>'licensor_share'),
    composition_title = btrim(f->>'composition_title'),
    writer_names = btrim(f->>'writer_names'),
    production_name = btrim(f->>'production_name'),
    client_name = btrim(f->>'client_name'),
    brand = btrim(f->>'brand'),
    campaign = btrim(f->>'campaign'),
    scripts = btrim(f->>'scripts'),
    cutdowns = btrim(f->>'cutdowns'),
    media = btrim(f->>'media'),
    territory = btrim(f->>'territory'),
    term = btrim(f->>'term'),
    first_transmission = btrim(f->>'first_transmission'),
    licence_fee = btrim(f->>'licence_fee'),
    updated_at = now()
  where uuid = p_uuid and status <> 'Archived';
  if not found then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
  return public.track_composition_licence_detail(p_uuid)
         || jsonb_build_object('key', (select aws_path from public.track_composition_licences where uuid = p_uuid));
end
$$;

create or replace function public.track_project_composition_licences(p_project_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', r.id, 'uuid', r.uuid, 'ref', public.track_ref('licence', r.id), 'kind', r.kind,
             'licensee_name', r.licensee_name, 'composition_title', r.composition_title,
             'invoice_number', r.invoice_number, 'issued_on', r.issued_on,
             'brand', r.brand, 'campaign', r.campaign, 'sent_at', r.sent_at,
             'created_at', r.created_at) as x
      from public.track_composition_licences r
     where r.project_master_list_id = p_project_id and r.status <> 'Archived'
  ) s;
  return v;
end
$$;

/* The client's /licence page needs to know which licence it is showing:
 * details gains licence_kind (sign-asset passes details through untouched). */
create or replace function public.resolve_share_link(p_code text, p_ip text)
returns jsonb
language plpgsql security definer
set search_path = xano_mirror, public, pg_catalog
as $$
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
        'licence_kind', v_licence.kind,
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
$$;

/* "dane@agency.com opened the library licence for Mozart." */
create or replace function public.track_notify_share_event(p_code text, p_event text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
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
      format('%s %s the %s for %s.',
             coalesce(nullif(btrim(coalesce(v_link.recipient, '')), ''),
                      nullif(btrim(coalesce(v_lic.sent_to, '')), ''), 'Someone'),
             v_what,
             case when v_lic.kind = 'library' then 'library licence' else 'licence' end,
             coalesce(nullif(btrim(coalesce(v_lic.composition_title, '')), ''),
                      case when v_lic.kind = 'library' then 'a track' else 'a composition' end)),
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
$$;
