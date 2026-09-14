-- Track's brief row shows "Link expired" for a Requested brief whose share
-- link no longer works. In Xano that is implicit: the endpoint only returns a
-- share_token while the link would still work, so an absent token means
-- lapsed. Reading the mirror directly there is no endpoint to do the hiding,
-- so the rule is stated here instead — and the token itself stays out of the
-- view, since nothing on the page needs its value.

drop view if exists xano_mirror.project_briefs;
create view xano_mirror.project_briefs with (security_invoker = true) as
select b.id,
       b.project_master_list_id,
       b.name,
       b.brief_type,
       b.status,
       b.source,
       b.one_sentence_brief,
       b.vocal_or_instrumental,
       b.client_deadline,
       b.sequel_deadline,
       b.submitted_at,
       u.name as requested_by,
       (nullif(btrim(b.share_token), '') is not null
        and (b.share_expires_at is null or b.share_expires_at > now())) as share_link_live,
       b.created_at
  from xano_mirror.briefs b
  left join xano_mirror."user" u on u.id = b.requested_by;

grant select on xano_mirror.project_briefs to authenticated;
