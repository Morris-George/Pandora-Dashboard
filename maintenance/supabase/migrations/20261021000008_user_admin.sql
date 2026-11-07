-- User administration: where an account came from, and forced password change after admin-issued passwords
alter table profiles
  add column source text not null default 'manual' check (source in ('manual', 'erpnext')),
  add column erp_user text,
  add column must_change_password boolean not null default false;

-- Users may clear their own must_change_password flag (and nothing else on their profile)
create or replace function password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;
revoke execute on function password_changed() from public, anon;
grant execute on function password_changed() to authenticated;
