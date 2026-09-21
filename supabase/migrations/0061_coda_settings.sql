-- Coda's own settings, readable.
--
-- ⚠️ `track_ai_prompts` has row-level security ON and NOT ONE POLICY, so a
-- signed-in account selecting from it gets no rows — not an error, no rows.
-- Coda read her provider straight from the table, got null, and fell back to
-- the Anthropic default, which is why she reported a missing ANTHROPIC_API_KEY
-- while the row plainly said `google`. The contract summariser never hit this
-- because it goes through `track_ai_prompt()`, which is SECURITY DEFINER.
--
-- The table is left shut. This function is the door, and it hands back only
-- Coda's row.
create or replace function public.coda_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'prompt',   coalesce(p.prompt_text, ''),
    'version',  coalesce(p.prompt_version, 'v0'),
    'model',    p.model,
    'provider', p.provider
  )
  from public.track_ai_prompts p
  where p.prompt_key = 'coda_system'
$$;

revoke execute on function public.coda_settings() from public, anon;
grant execute on function public.coda_settings() to authenticated;

comment on function public.coda_settings is
  'Coda''s prompt, model and provider. A function rather than a select because
   track_ai_prompts has RLS enabled with no policies.';
