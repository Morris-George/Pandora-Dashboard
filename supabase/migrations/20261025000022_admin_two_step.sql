-- Super Admins act only after two-step login (aal2). Without it their session has no role at all.
create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as $$
  select case
    when role = 'admin' and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then null
    else coalesce(case when role = 'admin' then acting_role end, role) end
  from profiles where id = auth.uid() and active
$$;

create or replace function is_real_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin' and acting_role is null)
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function in_my_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b)
    or (exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
        and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;
