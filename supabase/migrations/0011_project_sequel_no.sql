-- The Sequel number ("122-KNO-26-II") has been arriving from Xano all along,
-- as sequel_no inside the raw payload, and nothing read it. The app was
-- instead parsing a number off the front of the project name, which no
-- project has -- so every number in the UI was silently blank.
--
-- It is a first-class field, so it gets a column rather than a jsonb lookup.
alter table public.projects_mirror add column if not exists sequel_no text;

update public.projects_mirror
   set sequel_no = raw ->> 'sequel_no'
 where sequel_no is null
   and raw ? 'sequel_no';
