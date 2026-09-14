-- The sync runs as service_role and is the only writer the mirror has. Usage
-- was granted to `authenticated` alone when the schema was created, so the
-- Edge Function could not reach it at all.
grant usage on schema xano_mirror to service_role;
grant all on all tables in schema xano_mirror to service_role;
grant all on all sequences in schema xano_mirror to service_role;

-- Tables added to the mirror later should be writable by the sync without
-- anyone remembering to come back here.
alter default privileges in schema xano_mirror grant all on tables to service_role;
alter default privileges in schema xano_mirror grant all on sequences to service_role;
