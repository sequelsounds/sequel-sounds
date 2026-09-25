-- 0086_invite_reminder_partner_link
--
-- Partners are invited the same way as roster teams since 0085, so the
-- "hasn't added their details a week after being invited" reminder in
-- track_my_notifications (0083) now links a partner to /partners/:uuid, not
-- /roster/:uuid. Patched in place, applied 25 Sep 2026: only the invite
-- reminder's select (adds s.supplier_type) and its link change.

do $$
declare
  v_def text := pg_get_functiondef('public.track_my_notifications'::regproc);
  v_old text := $o$'supplier', r.uuid, '/roster/' || r.uuid)
    on conflict (user_id, kind, subject_uuid) where subject_uuid is not null do nothing;
  end loop;

  for r in$o$;
  v_new text := $n$'supplier', r.uuid, case when r.supplier_type = 'Composition Team' then '/roster/' else '/partners/' end || r.uuid)
    on conflict (user_id, kind, subject_uuid) where subject_uuid is not null do nothing;
  end loop;

  for r in$n$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'track_my_notifications: invite reminder block not found';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def,
    $o$select s.uuid, coalesce(nullif(trim(s.title), ''), o.invite_email) as name, o.invited_at$o$,
    $n$select s.uuid, s.supplier_type, coalesce(nullif(trim(s.title), ''), o.invite_email) as name, o.invited_at$n$);
  execute v_def;
end $$;
