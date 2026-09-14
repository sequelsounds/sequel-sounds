-- file_size arrives from Xano as text, so every asset's size rendered as an
-- em dash: the formatter takes a number and "47201" is not one. Cast here
-- rather than in the page, so the next thing to read this view gets a number
-- too. Guarded, because a column typed text can hold anything.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW cannot
-- change a column's type.

drop view if exists xano_mirror.project_files;
create view xano_mirror.project_files with (security_invoker = true) as
select a.id,
       a.project_master_list_id,
       a.file_name,
       a.description,
       a.asset_tag,
       case when btrim(a.file_size::text) ~ '^[0-9]+$'
            then (btrim(a.file_size::text))::bigint end as file_size,
       a.file_type,
       a.url,
       a.final_edit,
       u.name as uploaded_by,
       a.created_at
  from xano_mirror.project_assets a
  left join xano_mirror."user" u on u.id = a.uploaded_by;

grant select on xano_mirror.project_files to authenticated;
