-- Composition licences — Sequel → the client, for a composition Sequel owns.
--
-- Decisions (Andy, 25 Sep 2026; claude/sequel-track-composition-licence-decisions.md):
--  1. INVOICE FIRST. "A client doesn't get a licence without the invoice being
--     raised first." A licence is created FROM a raised invoice on the project,
--     and the invoice's number is printed on the certificate. The number is
--     snapshotted here by the database; the browser never supplies it.
--  2. ONE LIST. Licences sit in the Contracting tab's list with supplier
--     contracts and release forms, told apart by type.
--  3. WRITERS, NOT ARTIST. The schedule names the individual writers.
--
-- ⚠️ OUTSIDE THE XANO MIRROR, like track_release_forms. xano_mirror.contracts
-- is supplier-shaped (licensed IN) and the hourly sync deletes rows it did not
-- create; a licence points OUT and has no Xano counterpart.
--
-- ⚠️ THE FILE KEY IS contracts/licences/<uuid>.pdf — under contracts/*, which
-- sequel-sounds-signer can already Put/Get. No IAM change.

create table if not exists public.track_composition_licences (
  id                     bigserial primary key,
  uuid                   uuid not null unique default gen_random_uuid(),
  project_master_list_id bigint not null,
  invoice_id             bigint not null,
  invoice_number         text not null,
  sequel_no              text not null,
  licensee_name          text not null,
  licensee_address       text,
  rights_granted         text not null,
  licensor_share         text not null,
  composition_title      text not null,
  writer_names           text not null,
  production_name        text not null,
  client_name            text not null,
  brand                  text not null,
  campaign               text not null,
  scripts                text not null,
  cutdowns               text not null,
  media                  text not null,
  territory              text not null,
  term                   text not null,
  first_transmission     text not null,
  licence_fee            text not null,
  issued_on              date not null,
  aws_path               text not null,
  file_name              text not null,
  status                 text not null default 'Active',
  created_by             bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  -- Emailed from the app (Send…). null until then.
  sent_at                timestamptz,
  sent_to                text,
  send_error             text
);
comment on table public.track_composition_licences is
  'Composition licences issued by Sequel to clients. Created from a raised invoice, whose number prints on the certificate.';
create index if not exists track_composition_licences_project_idx
  on public.track_composition_licences (project_master_list_id, created_at desc);

alter table public.track_composition_licences enable row level security;
drop policy if exists track_composition_licences_read on public.track_composition_licences;
create policy track_composition_licences_read on public.track_composition_licences
  for select to authenticated using (public.track_is_staff());
grant select on public.track_composition_licences to authenticated;

-- '#12-L'
create or replace function public.track_ref(p_kind text, p_id bigint)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
           when p_id is null then null
           when p_kind = 'contract' then '#' || p_id || '-C'
           when p_kind = 'quote'    then '#' || p_id || '-Q'
           when p_kind = 'song'     then '#' || p_id || '-S'
           when p_kind = 'release'  then '#' || p_id || '-R'
           when p_kind = 'licence'  then '#' || p_id || '-L'
           else '#' || p_id
         end
$$;

-- Currency as a code, never a symbol. Xano stores euro as 'EURO'.
create or replace function public.track_currency_code(p_currency_id bigint)
returns text
language sql
stable
security definer
set search_path to 'xano_mirror', 'pg_catalog'
as $$
  select case when upper(c.currency) = 'EURO' then 'EUR' else upper(c.currency) end
    from xano_mirror.currencies_bank_accounts c where c.id = p_currency_id
$$;
revoke all on function public.track_currency_code(bigint) from public, anon;
grant execute on function public.track_currency_code(bigint) to authenticated;

/* ------------------------------------------------ the invoices to pick from
 * Raised = has a number and is Awaiting Payment or Paid. Drafts and archived
 * invoices never appear: a licence cannot print a number that does not exist. */
create or replace function public.track_licence_invoices(p_project_id bigint)
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
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', i.id,
             'invoice_number', i.invoice_number,
             'invoice_date', i.invoice_date,
             'status', i.status,
             'currency', public.track_currency_code(i.currency_id),
             'total', i.total_to_invoice,
             'client', c.company,
             'licences', (select count(*) from public.track_composition_licences l
                           where l.invoice_id = i.id and l.status <> 'Archived')) as x
      from xano_mirror.invoices i
      left join xano_mirror.clients c on c.id = i.client_id
     where i.project_master_list_id = p_project_id
       and btrim(coalesce(i.invoice_number, '')) <> ''
       and i.status in ('Awaiting Payment', 'Paid')
  ) s;
  return v;
end
$function$;

/* ------------------------------------------------ the songs to pick from
 * Writers from sequel_song_writer where the song has rows there (the app's
 * own), else the old composer1..8 columns. */
create or replace function public.track_licence_songs(p_project_id bigint)
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
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', s.id,
             'title', s.track_title,
             'writers', coalesce(
               (select string_agg(btrim(w.full_name), ', ' order by w.id)
                  from xano_mirror.sequel_song_writer w
                 where w.song_id = s.id and btrim(coalesce(w.full_name, '')) <> ''),
               nullif(concat_ws(', ',
                 nullif(btrim(coalesce(s.composer1, '')), ''), nullif(btrim(coalesce(s.composer2, '')), ''),
                 nullif(btrim(coalesce(s.composer3, '')), ''), nullif(btrim(coalesce(s.composer4, '')), ''),
                 nullif(btrim(coalesce(s.composer5, '')), ''), nullif(btrim(coalesce(s.composer6, '')), ''),
                 nullif(btrim(coalesce(s.composer7, '')), ''), nullif(btrim(coalesce(s.composer8, '')), '')), ''),
               '')) as x
      from xano_mirror.sequel_songs s
     where s.project_master_list_id = p_project_id
       and s.status is distinct from 'Archived'
  ) q;
  return v;
end
$function$;

/* ------------------------------------------------ the starting point
 * Everything the project and the chosen invoice already know. A STARTING
 * POINT: every value is editable in the modal. */
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

/* ------------------------------------------------ validation shared by create and update */
create or replace function public.track_licence_check_fields(p_fields jsonb)
returns void
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare k text;
begin
  foreach k in array array['licensee_name', 'rights_granted', 'licensor_share', 'composition_title',
                           'writer_names', 'production_name', 'client_name', 'brand', 'campaign',
                           'scripts', 'cutdowns', 'media', 'territory', 'term', 'first_transmission',
                           'licence_fee']
  loop
    if btrim(coalesce(p_fields->>k, '')) = '' then
      raise exception 'The % is needed before a licence can be created.', replace(k, '_', ' ')
        using errcode = '22023';
    end if;
  end loop;
end
$function$;

create or replace function public.track_composition_licence_detail(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
    'uuid', r.uuid, 'ref', public.track_ref('licence', r.id),
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
$function$;

create or replace function public.track_create_composition_licence(
  p_project_id bigint, p_invoice_id bigint, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'xano_mirror', 'pg_catalog'
as $function$
declare
  v_uuid uuid := gen_random_uuid();
  v_key  text;
  v_me   public.track_users%rowtype;
  p      xano_mirror.project_master_list%rowtype;
  i      xano_mirror.invoices%rowtype;
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can create licences.' using errcode = '42501';
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
  -- ⚠️ INVOICE FIRST — Andy, 25 Sep. No number, no licence.
  if btrim(coalesce(i.invoice_number, '')) = '' or i.status not in ('Awaiting Payment', 'Paid') then
    raise exception 'That invoice has not been raised yet. Raise the licence invoice first.' using errcode = '22023';
  end if;
  if btrim(coalesce(p.sequel_no, '')) = '' then
    raise exception 'This project has no Sequel No.' using errcode = '22023';
  end if;
  perform public.track_licence_check_fields(f);

  v_key := 'contracts/licences/' || v_uuid || '.pdf';
  insert into public.track_composition_licences
    (uuid, project_master_list_id, invoice_id, invoice_number, sequel_no,
     licensee_name, licensee_address, rights_granted, licensor_share, composition_title,
     writer_names, production_name, client_name, brand, campaign, scripts, cutdowns,
     media, territory, term, first_transmission, licence_fee,
     issued_on, aws_path, file_name, created_by)
  values
    (v_uuid, p_project_id, i.id, btrim(i.invoice_number), btrim(p.sequel_no),
     btrim(f->>'licensee_name'), nullif(btrim(coalesce(f->>'licensee_address', '')), ''),
     btrim(f->>'rights_granted'), btrim(f->>'licensor_share'), btrim(f->>'composition_title'),
     btrim(f->>'writer_names'), btrim(f->>'production_name'), btrim(f->>'client_name'),
     btrim(f->>'brand'), btrim(f->>'campaign'), btrim(f->>'scripts'), btrim(f->>'cutdowns'),
     btrim(f->>'media'), btrim(f->>'territory'), btrim(f->>'term'),
     btrim(f->>'first_transmission'), btrim(f->>'licence_fee'),
     v_today, v_key,
     'Licence ' || btrim(p.sequel_no) || ' ' || btrim(f->>'composition_title') || '.pdf',
     v_me.id);

  return public.track_composition_licence_detail(v_uuid) || jsonb_build_object('key', v_key);
end
$function$;

create or replace function public.track_update_composition_licence(p_uuid uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform public.track_licence_check_fields(f);
  -- ⚠️ The invoice, its number, the Sequel No. and the issue date do not move
  -- on an edit: they are what the client was told.
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
$function$;

create or replace function public.track_composition_licence_key(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare r public.track_composition_licences%rowtype;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.track_composition_licences where uuid = p_uuid;
  if not found then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('key', r.aws_path, 'file_name', r.file_name);
end
$function$;

create or replace function public.track_project_composition_licences(p_project_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'id', r.id, 'uuid', r.uuid, 'ref', public.track_ref('licence', r.id),
             'licensee_name', r.licensee_name, 'composition_title', r.composition_title,
             'invoice_number', r.invoice_number, 'issued_on', r.issued_on,
             'brand', r.brand, 'campaign', r.campaign, 'sent_at', r.sent_at,
             'created_at', r.created_at) as x
      from public.track_composition_licences r
     where r.project_master_list_id = p_project_id and r.status <> 'Archived'
  ) s;
  return v;
end
$function$;

-- Used only when drawing or storing fails straight after create, so a listed
-- licence always has a file behind it. Never removes one that has been edited.
create or replace function public.track_discard_composition_licence(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.track_composition_licences where uuid = p_uuid and updated_at is null;
end
$function$;

/* ------------------------------------------------ share and archive */
alter table public.share_links add column if not exists licence_uuid uuid;
alter table public.share_links drop constraint if exists share_links_one_target;
alter table public.share_links add constraint share_links_one_target
  check (num_nonnulls(asset_uuid, contract_uuid, release_form_uuid, licence_uuid) = 1);

create or replace function public.track_share_composition_licence(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text := public.share_code();
  v_expires timestamptz := now() + interval '7 days';
begin
  if not public.track_is_staff() then
    raise exception 'Only Sequel staff can share licences.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.track_composition_licences r
                  where r.uuid = p_uuid and r.status is distinct from 'Archived') then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
  insert into public.share_links (code, licence_uuid, created_by, expires_at)
  values (v_code, p_uuid, public.track_user_id(), v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end
$function$;

-- ⚠️ Archives, never deletes. The licence was issued; the record is evidence.
create or replace function public.track_archive_composition_licence(p_uuid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.share_links s where s.licence_uuid = p_uuid;
  update public.track_composition_licences set status = 'Archived' where uuid = p_uuid;
  if not found then
    raise exception 'Licence not found.' using errcode = 'P0002';
  end if;
end
$function$;

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

  -- Composition licences (0087). 'licence' sends the share page straight to
  -- the PDF, as a release form does — the client gets the document, not the
  -- project-asset viewer.
  if v_link.licence_uuid is not null then
    select * into v_licence from public.track_composition_licences r where r.uuid = v_link.licence_uuid;
    if not found or coalesce(v_licence.aws_path, '') = ''
       or v_licence.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'licence',
      'key', v_licence.aws_path,
      'file_name', v_licence.file_name,
      'file_type', 'application/pdf',
      'file_size', null,
      'expires_at', v_link.expires_at
    );
  end if;

  if v_link.release_form_uuid is not null then
    select * into v_release from public.track_release_forms r where r.uuid = v_link.release_form_uuid;
    if not found or coalesce(v_release.aws_path, '') = ''
       or v_release.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'release_form',
      'key', v_release.aws_path,
      'file_name', v_release.file_name,
      'file_type', 'application/pdf',
      'file_size', null,
      'expires_at', v_link.expires_at
    );
  end if;

  if v_link.contract_uuid is not null then
    select * into v_contract from xano_mirror.contracts c where c.uuid = v_link.contract_uuid;
    if not found or coalesce(v_contract.aws_path, '') = ''
       or v_contract.status is not distinct from 'Archived' then
      return jsonb_build_object('error', 'invalid');
    end if;
    return jsonb_build_object(
      'kind', 'contract',
      'key', v_contract.aws_path,
      'file_name', v_contract.file_name,
      'file_type', coalesce(nullif(v_contract.file_type, ''), 'application/pdf'),
      'file_size', v_contract.file_size,
      'expires_at', v_link.expires_at
    );
  end if;

  select * into v_asset from xano_mirror.project_assets a where a.uuid = v_link.asset_uuid;
  if not found or coalesce(v_asset.aws_path, '') = '' then
    return jsonb_build_object('error', 'invalid');
  end if;
  return jsonb_build_object(
    'kind', 'asset',
    'key', v_asset.aws_path,
    'file_name', v_asset.file_name,
    'file_type', v_asset.file_type,
    'file_size', v_asset.file_size,
    'expires_at', v_link.expires_at,
    'peaks', (select p.peaks from public.asset_peaks p where p.asset_uuid = v_asset.uuid)
  );
end
$function$;

/* ------------------------------------------------ grants */
revoke all on function public.track_licence_invoices(bigint) from public, anon;
revoke all on function public.track_licence_songs(bigint) from public, anon;
revoke all on function public.track_licence_prefill(bigint, bigint) from public, anon;
revoke all on function public.track_licence_check_fields(jsonb) from public, anon;
revoke all on function public.track_create_composition_licence(bigint, bigint, jsonb) from public, anon;
revoke all on function public.track_update_composition_licence(uuid, jsonb) from public, anon;
revoke all on function public.track_composition_licence_detail(uuid) from public, anon;
revoke all on function public.track_composition_licence_key(uuid) from public, anon;
revoke all on function public.track_project_composition_licences(bigint) from public, anon;
revoke all on function public.track_discard_composition_licence(uuid) from public, anon;
revoke all on function public.track_share_composition_licence(uuid) from public, anon;
revoke all on function public.track_archive_composition_licence(uuid) from public, anon;
grant execute on function public.track_licence_invoices(bigint) to authenticated;
grant execute on function public.track_licence_songs(bigint) to authenticated;
grant execute on function public.track_licence_prefill(bigint, bigint) to authenticated;
grant execute on function public.track_licence_check_fields(jsonb) to authenticated;
grant execute on function public.track_create_composition_licence(bigint, bigint, jsonb) to authenticated;
grant execute on function public.track_update_composition_licence(uuid, jsonb) to authenticated;
grant execute on function public.track_composition_licence_detail(uuid) to authenticated;
grant execute on function public.track_composition_licence_key(uuid) to authenticated;
grant execute on function public.track_project_composition_licences(bigint) to authenticated;
grant execute on function public.track_discard_composition_licence(uuid) to authenticated;
grant execute on function public.track_share_composition_licence(uuid) to authenticated;
grant execute on function public.track_archive_composition_licence(uuid) to authenticated;

/* ------------------------------------------------ sending (Send…)
 * The same shape as the release form: the email carries a LINK to the share
 * page, never an attachment, and the link is one permanent 'sent' link per
 * licence so every email about it points at the same place. */
create or replace function public.track_licence_send_link(p_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text;
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
   where s.licence_uuid = p_uuid and s.purpose = 'sent';
  if v_code is null then
    v_code := public.share_code();
    insert into public.share_links (code, licence_uuid, created_by, expires_at, purpose)
    values (v_code, p_uuid, public.track_user_id(), null, 'sent');
  end if;
  return jsonb_build_object('code', v_code);
end
$function$;

create or replace function public.track_mark_licence_sent(p_uuid uuid, p_to text, p_error text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.track_composition_licences
     set sent_at    = case when p_error is null then now() else sent_at end,
         sent_to    = case when p_error is null then p_to else sent_to end,
         send_error = p_error
   where uuid = p_uuid;
end
$function$;

revoke all on function public.track_licence_send_link(uuid) from public, anon;
revoke all on function public.track_mark_licence_sent(uuid, text, text) from public, anon;
grant execute on function public.track_licence_send_link(uuid) to authenticated;
grant execute on function public.track_mark_licence_sent(uuid, text, text) to authenticated;

/* ------------------------------------------------ opened / downloaded
 * Recorded exactly as the release form's are: sign-asset logs every resolve of
 * a share link into track_share_events (view, or download from the page's
 * button), then calls track_notify_share_event. That function now also
 * notifies for a licence's SENT link — once per kind per licence (the unique
 * index on user_id, kind, subject_uuid), to whoever sent it.
 *
 * ⚠️ OPENS, NOT PEOPLE. A forwarded link is somebody else; this says the link
 * was opened, never that the addressee read it. */
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
             coalesce(nullif(btrim(coalesce(v_lic.sent_to, '')), ''), 'Someone'),
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

/* The line at the top of the licence's share menu: "Sent 26 Sep · opened twice". */
create or replace function public.track_licence_activity(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text;
  v_sent_at timestamptz;
  v_sent_to text;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select r.sent_at, r.sent_to into v_sent_at, v_sent_to
    from public.track_composition_licences r where r.uuid = p_uuid;
  select s.code into v_code
    from public.share_links s
   where s.licence_uuid = p_uuid and s.purpose = 'sent';
  return jsonb_build_object(
    'sent_at', v_sent_at,
    'sent_to', v_sent_to,
    'views', (select count(*) from public.track_share_events e where e.code = v_code and e.event = 'view'),
    'downloads', (select count(*) from public.track_share_events e where e.code = v_code and e.event = 'download'),
    'last_view', (select max(e.created_at) from public.track_share_events e where e.code = v_code and e.event = 'view'),
    'last_download', (select max(e.created_at) from public.track_share_events e where e.code = v_code and e.event = 'download'));
end
$function$;
revoke all on function public.track_licence_activity(uuid) from public, anon;
grant execute on function public.track_licence_activity(uuid) to authenticated;
