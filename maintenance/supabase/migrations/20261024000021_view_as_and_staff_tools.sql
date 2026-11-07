-- "View as": a Super Admin can switch to any role and see/act exactly as that role
-- (full access returns when switched back). Store roles cover every store while viewing as them.
create or replace function is_real_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin' and acting_role is null)
$$;

create or replace function in_my_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b)
    or exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
$$;

create or replace function set_acting_role(r app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update profiles set acting_role = case when r = 'admin' then null else r end where id = auth.uid();
  insert into audit_log (user_id, role, entity, entity_id, action, new_value)
    values (auth.uid(), 'admin', 'profiles', auth.uid()::text, 'view_as', jsonb_build_object('role', r));
end $$;
revoke execute on function set_acting_role(app_role) from public, anon;
grant execute on function set_acting_role(app_role) to authenticated;

-- Stop sync for one sales person: the nightly sync no longer changes their store or status
alter table sales_persons add column if not exists sync_paused boolean not null default false;

-- Admin-set names are kept: the ERPNext sync stops overwriting a locked name
alter table profiles add column if not exists name_locked boolean not null default false;
