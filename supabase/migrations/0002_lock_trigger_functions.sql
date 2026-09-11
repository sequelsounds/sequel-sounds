-- Trigger functions are not meant to be called over the REST API. They are
-- SECURITY DEFINER so they can write past RLS when fired by a trigger; leaving
-- EXECUTE granted also publishes them at /rest/v1/rpc/<name>.
-- public.register_viewer() keeps its grant — anon is meant to call that one.
revoke execute on function public.create_inbox_for_project() from anon, authenticated, public;
revoke execute on function public.touch_updated_at() from anon, authenticated, public;
