-- `supplier_list.id` had no default, because every row arrived from Xano
-- carrying Xano's own id. That was right while this was a replica and is wrong
-- now that it is the original: an insert had nothing to put in the primary key
-- and failed with a not-null violation.
--
-- The sequence starts well clear of the highest id Xano ever issued (152 at the
-- time of writing, 131 rows), so a new supplier cannot collide with a historic
-- one and the gap makes it obvious which side of the cutover a row was created.
--
-- ⚠️ This is another reason `supplier_list` must never go back into task 42.
-- The sync upserts on `id`, so a Supabase-created supplier would either
-- collide with a Xano row or be deleted as one Xano does not have. The task's
-- header comment already says not to re-add it; this is the mechanism behind
-- that warning.
create sequence if not exists xano_mirror.supplier_list_id_seq as bigint start with 1000 owned by xano_mirror.supplier_list.id;

select setval('xano_mirror.supplier_list_id_seq', greatest(1000, (select coalesce(max(id), 0) + 1 from xano_mirror.supplier_list)), false);

alter table xano_mirror.supplier_list
  alter column id set default nextval('xano_mirror.supplier_list_id_seq');

grant usage, select on sequence xano_mirror.supplier_list_id_seq to authenticated;
