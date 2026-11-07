-- Owner's decision: the Super Admin has full access to every screen and action (all roles, all stores).
-- Every action is still logged under the admin's own user id. Role changes still need a second admin.

-- acting_role: left from a short-lived "act as" switch; kept null
alter table profiles add column if not exists acting_role app_role;
alter table profiles drop constraint if exists acting_role_admin_only;
alter table profiles add constraint acting_role_admin_only check (acting_role is null or (role = 'admin' and acting_role <> 'admin'));

create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as $$
  select coalesce(case when role = 'admin' then acting_role end, role) from profiles where id = auth.uid() and active
$$;

create or replace function is_real_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
$$;
revoke execute on function is_real_admin() from public, anon;
grant execute on function is_real_admin() to authenticated;

create or replace function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name() = any (roles), false) or is_real_admin()
$$;

create or replace function in_my_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b) or is_real_admin()
$$;

create or replace function can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when is_real_admin() then true
    when has_role('associate', 'manager') then in_my_branch(b)
    when has_role('courier', 'hq', 'technician', 'supervisor', 'cs', 'finance', 'ops') then true
    else false
  end
$$;

create or replace function can_read_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_see_branch(b) or has_role('admin')
$$;
revoke execute on function can_read_branch(uuid) from public, anon;
grant execute on function can_read_branch(uuid) to authenticated;

do $$
declare p record; def text;
begin
  for p in select tablename, policyname, qual from pg_policies
           where schemaname = 'public' and cmd = 'SELECT' and qual like '%can_see_branch%' loop
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, replace(p.qual, 'can_see_branch(', 'can_read_branch('));
  end loop;
  def := pg_get_functiondef('public.transition_ticket(uuid, ticket_status, text)'::regprocedure);
  def := replace(def, 'if not (current_role_name() = any (rule.allowed_roles)) then', 'if not (current_role_name() = any (rule.allowed_roles) or is_real_admin()) then');
  execute def;
  def := pg_get_functiondef('public.customers_masked()'::regprocedure);
  def := replace(def, 'and current_role_name() <> ''admin''', '');
  execute def;
end $$;

alter policy customers_read on customers using (has_role('associate', 'manager', 'supervisor', 'cs', 'finance', 'admin'));
alter policy diag_read on diagnoses using (has_role('technician', 'supervisor', 'cs', 'ops', 'admin'));

create or replace function report_level_for(r text) returns report_level
language sql stable security definer set search_path = public as $$
  select case when has_role('admin') then 'export'::report_level
    else coalesce((select level from report_access where report_key = r and role = current_role_name()), 'none') end
$$;

create or replace function can_see_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tickets t where t.id = p_ticket and can_read_branch(t.branch_id))
$$;

create or replace function set_acting_role(r app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_real_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update profiles set acting_role = case when r = 'admin' then null else r end where id = auth.uid();
end $$;
revoke execute on function set_acting_role(app_role) from public, anon;
grant execute on function set_acting_role(app_role) to authenticated;
