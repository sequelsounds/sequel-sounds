-- 0074_notifications_carry_project
--
-- The Notifications page gains a Project column (Sequel No. and title), laid
-- out like /projects. The name is looked up at read time from the project, not
-- stored on the notification: the message is a snapshot of what happened, the
-- project column is where it lives now.

create or replace function public.track_my_notifications(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_me bigint := public.track_user_id();
begin
  if v_me is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.track_notifications n
                where n.user_id = v_me and n.read_at is null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (
          select n.id, n.kind, n.message, n.project_id, n.subject_kind,
                 n.subject_uuid, n.created_at, n.read_at,
                 p.sequel_no as project_sequel_no,
                 p.title     as project_title
            from public.track_notifications n
            left join xano_mirror.project_master_list p on p.id = n.project_id
           where n.user_id = v_me
           order by n.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 200))
        ) x), '[]'::jsonb));
end
$function$;
