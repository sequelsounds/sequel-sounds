-- Coda: the assistant, her conversations, and an audit trail for everything
-- she does.
--
-- Three ideas hold this together:
--
--   1. Coda has no powers of her own. Every statement she makes runs as the
--      person talking to her, so the row-level policies already on these
--      tables decide what she may see and change. A client user asking her
--      for the margin on someone else's project gets nothing, for the same
--      reason the page would show them nothing.
--
--   2. Every tool call is written down, by the server, whether it worked or
--      not. The old Coda could create a supplier with no record of who asked
--      — `sequel-track-coda.md` §8.2. Nobody can forge or suppress a row
--      here: the audit table has no insert policy at all, so only the edge
--      function's service role can write to it.
--
--   3. Her prompt and her model live in the database, beside the contract
--      prompts, so both can be changed without a deploy.

-- ---------------------------------------------------------------- settings --

-- The contract prompts pin their model in code. Coda's belongs here so the
-- model can be swapped — to Haiku when cost matters, or another provider
-- entirely — without redeploying the function.
alter table public.track_ai_prompts
  add column if not exists model text,
  add column if not exists provider text;

comment on column public.track_ai_prompts.model is
  'Model id for this prompt. Null means the function''s own default.';
comment on column public.track_ai_prompts.provider is
  'anthropic | google | openai-compatible. Null means anthropic.';

insert into public.track_ai_prompts (prompt_key, prompt_text, prompt_version, model, provider)
values (
  'coda_system',
  $prompt$You are Coda, the assistant inside Sequel Track — the platform Sequel Sounds
runs its music supervision work on. You are talking to a member of the Sequel
team inside the app.

## How you work

You have tools. Use them. Never answer a question about Sequel's data from
memory or from what you were told earlier in the conversation if a tool can
tell you the current answer — figures change while people are talking to you.

`describe_data` lists everything you can read and what is in it. Call it when
you are unsure which resource holds something, rather than guessing a name.

Look things up before you act. If someone asks you to raise a quote on "the
Dove job", find the project first and confirm which one you mean if more than
one matches. Never act on a guess about which record someone meant.

## Writes

Before anything that changes a record, say plainly what you are about to do
and wait for a yes. One confirmation covers one action, not a session.

After a write, report exactly what happened: the reference the database
allocated, and a link. Never describe a write as done unless the tool told you
it was.

## What you cannot do

If a tool is not in your list, you cannot do that thing. Say so. Do not
improvise something adjacent and do not promise to do it later — you have no
later. The tools you have are the whole of what you can do.

If a tool returns an error, report the error as it came back and say you do
not know the cause. Never speculate about permissions, API keys, roles or
configuration: you cannot see any of it, and a confident wrong explanation
wastes an afternoon. Suggest the person checks with Andy.

Some tools are missing from your list because of who you are talking to.
Finance and management work is restricted. If someone asks for something you
have no tool for, say it is not available to their account rather than
guessing at why.

## How you write

Plain English, short. No preamble and no restating the question. Sequel's
people are busy and know their own business — give them the answer.

Money always carries its currency code, never a symbol. Refer to projects by
their Sequel No. and title. Dates as "14 Sep 2026".

When you list records, give the handful that matter and say how many there
were in total. Nobody wants forty rows in a chat window.

Never invent a figure, a name, a date or a reference. If you do not have it,
say you do not have it.$prompt$,
  'v1',
  'claude-sonnet-5',
  'anthropic'
)
on conflict (prompt_key) do nothing;

-- ----------------------------------------------------------- conversations --

create table if not exists public.coda_conversations (
  id          uuid primary key default gen_random_uuid(),
  auth_uid    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists coda_conversations_mine
  on public.coda_conversations (auth_uid, updated_at desc);

-- The transcript. `content` is the provider-shaped content array for the turn,
-- stored whole: tool calls and their results are part of the conversation and
-- replaying it without them would leave the model reading its own answers with
-- no idea where the figures came from.
create table if not exists public.coda_messages (
  id              bigserial primary key,
  conversation_id uuid not null references public.coda_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists coda_messages_thread
  on public.coda_messages (conversation_id, id);

-- ---------------------------------------------------------------- the audit --

-- Written by the edge function under the service role, never by the caller.
-- `source` separates the on-screen panel from the MCP server, because the same
-- tools answer to both and "who did this" is a different question in each.
create table if not exists public.coda_tool_calls (
  id              bigserial primary key,
  conversation_id uuid references public.coda_conversations(id) on delete set null,
  auth_uid        uuid,
  track_user_id   bigint,
  actor_email     text,
  source          text not null check (source in ('panel', 'mcp')),
  tool            text not null,
  args            jsonb,
  ok              boolean not null,
  summary         text,
  error           text,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);

create index if not exists coda_tool_calls_recent
  on public.coda_tool_calls (created_at desc);
create index if not exists coda_tool_calls_by_actor
  on public.coda_tool_calls (auth_uid, created_at desc);

-- -------------------------------------------------------------------- RLS --

alter table public.coda_conversations enable row level security;
alter table public.coda_messages      enable row level security;
alter table public.coda_tool_calls    enable row level security;

drop policy if exists coda_conversations_own on public.coda_conversations;
create policy coda_conversations_own on public.coda_conversations
  for all to authenticated
  using (auth_uid = auth.uid())
  with check (auth_uid = auth.uid());

drop policy if exists coda_messages_own on public.coda_messages;
create policy coda_messages_own on public.coda_messages
  for all to authenticated
  using (exists (
    select 1 from public.coda_conversations c
    where c.id = conversation_id and c.auth_uid = auth.uid()
  ))
  with check (exists (
    select 1 from public.coda_conversations c
    where c.id = conversation_id and c.auth_uid = auth.uid()
  ));

-- Read your own trail; management reads everyone's. No insert policy on
-- purpose — see the header.
drop policy if exists coda_tool_calls_read on public.coda_tool_calls;
create policy coda_tool_calls_read on public.coda_tool_calls
  for select to authenticated
  using (auth_uid = auth.uid() or public.track_is_management());

grant select, insert, update, delete on public.coda_conversations to authenticated;
grant select, insert on public.coda_messages to authenticated;
grant usage on sequence public.coda_messages_id_seq to authenticated;
grant select on public.coda_tool_calls to authenticated;

-- ----------------------------------------------------------------- whoami --

-- One round trip for everything the assistant needs to know about her caller:
-- who they are, and which of the three role gates they pass. The gates are the
-- existing ones, so this can never disagree with what the policies do.
create or replace function public.coda_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public, xano_mirror
as $$
  -- A subquery per field, not a FROM: track_me() returns no row for an account
  -- with no Track user, and this must still answer "not staff" rather than
  -- nothing at all.
  with me as (select * from public.track_me())
  select jsonb_build_object(
    'user_id',       (select id    from me),
    'name',          (select name  from me),
    'email',         (select email from me),
    'is_staff',      public.track_is_staff(),
    'is_finance',    public.track_is_finance(),
    'is_management', public.track_is_management()
  )
$$;

grant execute on function public.coda_whoami() to authenticated;

comment on function public.coda_whoami is
  'Who is talking to Coda and which role gates they pass. Used to decide which
   tools she is even offered — the policies still decide what actually runs.';
