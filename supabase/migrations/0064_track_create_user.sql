-- One typed door for creating a person.
--
-- The table stays shut: `authenticated` has SELECT on `user` and UPDATE on
-- five columns, and no INSERT grant at all. Rather than opening it up, this
-- function does the insert itself and checks staff explicitly — the same shape
-- as track_create_quote and the rest.
--
-- Names in, ids out. The caller says "Adpro" and "Ogilvy London", not 6 and
-- 41, because every caller — the app, Coda, Claude over MCP — is working from
-- what a person said rather than from the lookup tables.
--
-- ⚠️ EMAIL IS THE LOGIN, so it is required, lowercased, format-checked and
-- refused if another user already has it. Two rows sharing an email makes the
-- sign-in lookup ambiguous.
create or replace function public.track_create_user(
  p_name       text,
  p_email      text,
  p_user_type  text default null,
  p_status     text default null,
  p_company    text default null,
  p_job_title  text default null,
  p_notes      text default null
)
returns table (id bigint, uuid uuid)
language plpgsql
security definer
set search_path = public, xano_mirror
as $$
declare
  v_type_id    integer;
  v_status_id  integer;
  v_company_id integer;
  v_email      text := lower(trim(p_email));
  v_name       text := trim(p_name);
  v_new_id     bigint;
  v_new_uuid   uuid;
begin
  if not public.track_is_staff() then
    raise exception 'Refused: only Sequel staff can create users.'
      using errcode = '42501';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'A name is required.' using errcode = '23514';
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required.' using errcode = '23514';
  end if;

  if exists (select 1 from xano_mirror."user" u where lower(u.email) = v_email) then
    raise exception 'A user with the email % already exists.', v_email
      using errcode = '23505';
  end if;

  if p_user_type is not null and trim(p_user_type) <> '' then
    select ut.id into v_type_id
      from xano_mirror.user_types ut
     where lower(ut.user_type) = lower(trim(p_user_type));
    if v_type_id is null then
      raise exception 'No user type called %. Try one of: %', p_user_type,
        (select string_agg(ut.user_type, ', ' order by ut.id) from xano_mirror.user_types ut)
        using errcode = '23503';
    end if;
  end if;

  if p_status is not null and trim(p_status) <> '' then
    select us.id into v_status_id
      from xano_mirror.user_statuses us
     where lower(us.status) = lower(trim(p_status));
    if v_status_id is null then
      raise exception 'No status called %. Try one of: %', p_status,
        (select string_agg(us.status, ', ' order by us.id) from xano_mirror.user_statuses us)
        using errcode = '23503';
    end if;
  end if;

  if p_company is not null and trim(p_company) <> '' then
    select c.id into v_company_id
      from xano_mirror.clients c
     where lower(c.company) = lower(trim(p_company));
    if v_company_id is null then
      -- One unambiguous partial match is a kindness; two is a question.
      select c.id into v_company_id
        from xano_mirror.clients c
       where c.company ilike '%' || trim(p_company) || '%'
       limit 2;
      if v_company_id is null or (
        select count(*) from xano_mirror.clients c
         where c.company ilike '%' || trim(p_company) || '%'
      ) > 1 then
        raise exception 'No single client matches %. Use the exact company name.', p_company
          using errcode = '23503';
      end if;
    end if;
  end if;

  insert into xano_mirror."user" (name, email, user_type, status, company, job_title, notes)
  values (v_name, v_email, v_type_id, v_status_id, v_company_id, nullif(trim(p_job_title), ''), nullif(trim(p_notes), ''))
  returning xano_mirror."user".id, xano_mirror."user".uuid into v_new_id, v_new_uuid;

  return query select v_new_id, v_new_uuid;
end
$$;

revoke execute on function public.track_create_user(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.track_create_user(text, text, text, text, text, text, text) to authenticated;

comment on function public.track_create_user is
  'Create a person. Staff only, names resolved to ids, email required and
   unique because it is the login. The user table itself has no INSERT grant;
   this is the only way in.';
