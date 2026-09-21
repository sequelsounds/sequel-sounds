-- A conversation belongs to its provider.
--
-- Turns are stored in the shape the model that produced them uses: Anthropic's
-- content blocks are not Gemini's parts. Replaying an Anthropic transcript to
-- Gemini is not a conversion job, it is a 400 — so the provider is recorded
-- here, and changing the row in `track_ai_prompts` starts a new thread rather
-- than feeding a model a transcript it cannot read.
alter table public.coda_conversations
  add column if not exists provider text;

comment on column public.coda_conversations.provider is
  'The provider whose message shape this transcript is in. A mismatch starts a
   new conversation rather than converting.';

-- Coda now runs on the Gemini key the app already has set, rather than an
-- Anthropic key that does not exist yet. Flash rather than Flash Lite: the
-- other three Gemini calls in this app read one document each, and this one
-- picks between seventeen tools and chains lookups.
update public.track_ai_prompts
set provider = 'google', model = 'gemini-3.5-flash'
where prompt_key = 'coda_system';
