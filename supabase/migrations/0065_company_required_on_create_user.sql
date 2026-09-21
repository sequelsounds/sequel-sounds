-- A person without a company is a person nobody can place: the directory is
-- read by company on every client-facing page, and the two rows in 150 that
-- lack one are both mistakes. So it joins name and email as required.
--
-- Unchanged: the company is given BY NAME and must resolve to exactly one
-- client. There is deliberately no "create the client too" path here — a
-- misspelling would otherwise quietly mint a second Ogilvy.
--
-- The old signature took the same seven text arguments with p_company fourth
-- and defaulted, so it cannot be replaced in place and is dropped first.
-- Nothing else calls it: the app has no create-user page yet, and Coda reaches
-- it by name through track_create_user only.
drop function if exists public.track_create_user(text, text, text, text, text, text, text);

create function public.track_create_user(
  p_name      text,
  p_email     text,
  p_company   text,
  p_user_type text default null,
  p_status    text default null,
  p_job_title text default null,
  p_notes     text default null
)
returns table(id bigint, uuid uuid)
language plpgsql
security definer
set search_path = public, xano_mirror
as $$
declare
  v_type_id    integer;
  v_status_id  integer;
  v_company_id integer;
  v_matches    integer;
  v_email      text := lower(trim(p_email));
  v_name       text := trim(p_name);
  v_company    text := trim(p_company);
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

  -- The email is the login. A blank or duplicated one is not a cosmetic
  -- problem: the sign-in lookup is by email, and two rows sharing one makes
  -- that ambiguous.
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required.' using errcode = '23514';
  end if;

  if exists (select 1 from xano_mirror."user" u where lower(u.email) = v_email) then
    raise exception 'A user with the email % already exists.', v_email
      using errcode = '23505';
  end if;

  if v_company is null or v_company = '' then
    raise exception 'A company is required. Which client do they belong to?'
      using errcode = '23514';
  end if;

  select c.id into v_company_id
    from xano_mirror.clients c
   where lower(c.company) = lower(v_company);

  if v_company_id is null then
    -- One unambiguous partial match is a kindness; two is a question.
    select count(*) into v_matches
      from xano_mirror.clients c
     where c.company ilike '%' || v_company || '%';

    if v_matches = 1 then
      select c.id into v_company_id
        from xano_mirror.clients c
       where c.company ilike '%' || v_company || '%';
    elsif v_matches = 0 then
      raise exception 'No client called %. Create the client first, or use its exact name.',
        v_company using errcode = '23503';
    else
      raise exception 'More than one client matches %: %. Use the exact company name.',
        v_company,
        (select string_agg(c.company, ', ' order by c.company)
           from xano_mirror.clients c
          where c.company ilike '%' || v_company || '%')
        using errcode = '23503';
    end if;
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

  insert into xano_mirror."user" (name, email, user_type, status, company, job_title, notes)
  values (v_name, v_email, v_type_id, v_status_id, v_company_id,
          nullif(trim(p_job_title), ''), nullif(trim(p_notes), ''))
  returning xano_mirror."user".id, xano_mirror."user".uuid into v_new_id, v_new_uuid;

  return query select v_new_id, v_new_uuid;
end
$$;

revoke execute on function public.track_create_user(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.track_create_user(text, text, text, text, text, text, text)
  to authenticated;
