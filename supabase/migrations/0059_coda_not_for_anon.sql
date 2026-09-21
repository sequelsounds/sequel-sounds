-- Shut the anonymous role out of Coda.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and PUBLIC
-- includes `anon` — the role a signed-out browser gets. So `coda_catalogue()`,
-- which lists every view and column in the mirror, was callable by anyone with
-- the publishable key, and `coda_whoami()` with it. Neither returns another
-- person's data, but the catalogue is a map of the schema and there is no
-- reason to hand it out before sign-in.
--
-- The tables are the same shape of problem one level down: their policies are
-- `to authenticated`, so `anon` gets no rows, but the SELECT grant alone puts
-- them in the exposed GraphQL schema. The conversations are transcripts of
-- Sequel's work; they should not be discoverable at all.
--
-- ⚠️ This applies to every new SECURITY DEFINER function, not just these two.
-- `grant execute ... to authenticated` does not take anything away from PUBLIC;
-- the revoke has to be written out.

revoke execute on function public.coda_catalogue() from public, anon;
revoke execute on function public.coda_whoami() from public, anon;
grant execute on function public.coda_catalogue() to authenticated;
grant execute on function public.coda_whoami() to authenticated;

revoke all on public.coda_conversations from anon;
revoke all on public.coda_messages from anon;
revoke all on public.coda_tool_calls from anon;
revoke all on sequence public.coda_messages_id_seq from anon;
