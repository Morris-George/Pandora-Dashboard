-- System settings (Super Admin only). First one: whether Super Admins need two-step login.
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create trigger audit_app_settings after insert or update on app_settings for each row execute function audit_row();
insert into app_settings (key, value, updated_by) values ('admin_two_step', 'true', null) on conflict (key) do nothing;

-- True when this session may act as Super Admin: two-step done, or two-step switched off
create or replace function admin_session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or coalesce((select value = 'false'::jsonb from app_settings where key = 'admin_two_step'), false)
$$;
revoke execute on function admin_session_ok() from public, anon;
grant execute on function admin_session_ok() to authenticated;

create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as $$
  select case
    when role = 'admin' and not admin_session_ok() then null
    else coalesce(case when role = 'admin' then acting_role end, role) end
  from profiles where id = auth.uid() and active
$$;

create or replace function is_real_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin' and acting_role is null)
    and admin_session_ok()
$$;

create or replace function in_my_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b)
    or (exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') and admin_session_ok())
$$;

create policy app_settings_read on app_settings for select to authenticated using (auth.uid() is not null); -- read before two-step, to know if it is needed
create policy app_settings_admin on app_settings for update to authenticated using (has_role('admin')) with check (has_role('admin'));
