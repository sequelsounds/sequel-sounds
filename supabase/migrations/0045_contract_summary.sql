-- 0045_contract_summary
--
-- The contract page's AI read: the prompt, and the cache that stops us paying
-- for the same read twice.
--
-- This is the old app's model (api 564 + function 43), carried across:
--   ai_summary          the prose, or the reason it failed
--   ai_summary_version  the prompt version that produced it
--   ai_summary_status   'ok' or 'failed'
-- On open, the stored version is compared with the CURRENT prompt version. Same
-- version + ok + non-empty means show the stored copy and call nothing. Anything
-- else regenerates. Bumping prompt_version is therefore how every contract gets
-- re-read - no backfill, no migration.
--
-- ⚠️ EMPTY STRING COUNTS AS NEVER READ. Rows filed before these columns existed
-- carry '', not null. Treating '' as "already read" would leave every historic
-- contract permanently unread, which is exactly the bug the old app hit.
--
-- ⚠️ THE PROMPT IS DATA, NOT CODE, on purpose. It lives in a table so it can be
-- tuned without a deploy - the old one went through nine versions. The text is
-- seeded from the mirror, where Xano's tuned copy still sits; from here on this
-- table is the source and Xano's is a fossil.

create table if not exists public.track_ai_prompts (
  prompt_key     text primary key,
  prompt_text    text not null,
  prompt_version text not null,
  updated_at     timestamptz not null default now()
);

comment on table public.track_ai_prompts is
  'AI prompts the app sends, versioned. BUMP prompt_version IN THE SAME EDIT as prompt_text, or nothing regenerates.';

alter table public.track_ai_prompts enable row level security;
-- No policies: only the SECURITY DEFINER reader below touches it.

insert into public.track_ai_prompts (prompt_key, prompt_text, prompt_version)
select p.prompt_key, p.prompt_text, p.prompt_version
from xano_mirror.ai_prompts p
where p.prompt_key = 'contract_summary'
on conflict (prompt_key) do nothing;

-- The edge function reads the prompt through this rather than the table, so the
-- table needs no policy of its own.
create or replace function public.track_ai_prompt(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select jsonb_build_object('prompt_text', prompt_text, 'prompt_version', prompt_version)
    into v
  from public.track_ai_prompts
  where prompt_key = p_key;
  if v is null then
    raise exception 'No % prompt is configured.', p_key using errcode = 'P0002';
  end if;
  return v;
end
$$;

revoke all on function public.track_ai_prompt(text) from public;
grant execute on function public.track_ai_prompt(text) to authenticated;

-- Everything the contract page needs in one call, including whether the stored
-- summary is still current. The PDF url is signed separately: a signed url in a
-- cached response expires silently and the viewer then fails with no reason.
create or replace function public.track_contract_detail(p_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, xano_mirror
as $$
declare
  v_version text;
  v jsonb;
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select prompt_version into v_version
  from public.track_ai_prompts
  where prompt_key = 'contract_summary';

  select jsonb_build_object(
    'uuid', c.uuid,
    'file_name', c.file_name,
    'contract_type', t.type,
    'supplier', s.title,
    'artist', c.artist,
    'song_name', c.song_name,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'perpetual', coalesce(c.perpetual, false),
    'mcps_yn', coalesce(c.mcps_yn, false),
    'master_pct', c.master_pct,
    'publishing_pct', c.publishing_pct,
    'project_id', c.project_master_list_id,
    'project_uuid', p.uuid,
    'project_title', p.title,
    'project_sequel_no', p.sequel_no,
    'summary', nullif(btrim(coalesce(c.ai_summary, '')), ''),
    'summary_status', nullif(btrim(coalesce(c.ai_summary_status, '')), ''),
    'summary_version', nullif(btrim(coalesce(c.ai_summary_version, '')), ''),
    'prompt_version', v_version,
    'summary_current',
      coalesce(c.ai_summary_status, '') = 'ok'
      and nullif(btrim(coalesce(c.ai_summary, '')), '') is not null
      and nullif(btrim(coalesce(c.ai_summary_version, '')), '') is not distinct from v_version
  )
  into v
  from xano_mirror.contracts c
  left join xano_mirror.contract_types t on t.id = c.contract_type
  left join xano_mirror.supplier_list s on s.id = c.supplier_list_id
  left join xano_mirror.project_master_list p on p.id = c.project_master_list_id
  where c.uuid = p_uuid;

  if v is null then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  return v;
end
$$;

revoke all on function public.track_contract_detail(uuid) from public;
grant execute on function public.track_contract_detail(uuid) to authenticated;

-- ⚠️ A summary written onto a contract that came FROM Xano is wiped by the next
-- hourly full push, because the push keeps only app_created rows. That is
-- correct while Xano is still the record: it just means those contracts are
-- re-read once an hour until cutover. Contracts filed in this app keep theirs.
create or replace function public.track_save_contract_summary(
  p_uuid    uuid,
  p_summary text,
  p_status  text,
  p_version text
)
returns void
language plpgsql
security definer
set search_path = public, xano_mirror
as $$
begin
  if not public.track_is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_status not in ('ok', 'failed') then
    raise exception 'A summary is either ok or failed.' using errcode = '22023';
  end if;

  update xano_mirror.contracts
  set ai_summary = p_summary,
      ai_summary_status = p_status,
      ai_summary_version = p_version
  where uuid = p_uuid;

  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.track_save_contract_summary(uuid, text, text, text) from public;
grant execute on function public.track_save_contract_summary(uuid, text, text, text) to authenticated;
