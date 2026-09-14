-- SELECT to `authenticated` only, the same grant every other mirror view
-- carries. Not `anon`: nothing on this page is public, and the view's own
-- track_is_management() gate would return nothing anyway — but a signed-out
-- caller should be refused at the grant, not by an empty list.
grant select on xano_mirror.management_invoices to authenticated;
grant select on xano_mirror.management_projects to authenticated;
grant select on xano_mirror.management_staff    to authenticated;

