-- What a turn said, in words.
--
-- `content` holds the turn in the model's own shape — Gemini's parts, or
-- Anthropic's content blocks — because that is what has to be replayed. It is
-- unreadable to a person and useless to the panel, which needs a bubble.
--
-- So each turn now also carries its display text. Two things fall out of that:
-- the panel can read its own history straight from this table (the policies
-- already scope it to the signed-in person, so no endpoint is needed), and the
-- stored conversations are legible next to the audit trail rather than a wall
-- of JSON.
--
-- Null means the turn has nothing to show — a turn carrying tool results is
-- part of the conversation the model sees and no part of the one the person
-- sees.
alter table public.coda_messages
  add column if not exists text text;

comment on column public.coda_messages.text is
  'The turn as a person reads it. Null for a turn that only carries tool
   results. `content` remains the model-shaped version that gets replayed.';

create index if not exists coda_messages_shown
  on public.coda_messages (conversation_id, id)
  where text is not null;
