-- 15 Sep 2026, after the 17:00 sync. Mirror insert trap 3, in the sync itself.
--
-- 0018 stopped the sync sending 0 into a foreign key. But when Xano leaves a
-- field out of the payload altogether — project_assets never sends
-- uploaded_by — the insert takes the COLUMN DEFAULT, and every integer foreign
-- key in the mirror was created defaulting to Xano's 0. project_assets still
-- failed its whole push on "uploaded_by = 0".
--
-- Every foreign-key column whose default is 0 now has no default (null). None
-- is NOT NULL, and 0 can never satisfy the constraint, so nothing real is lost.
-- The two non-zero defaults (project_master_list.adpro_user 142 and
-- projects_status 1) are Xano's own and are left alone.
do $migration$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'xano_mirror'
       and c.contype = 'f'
       and array_length(c.conkey, 1) = 1
       and pg_get_expr(d.adbin, d.adrelid) = '0'
  loop
    execute format('alter table %s alter column %I drop default', r.tbl, r.col);
  end loop;
end
$migration$;
