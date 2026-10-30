-- Training store on the live system: training accounts see only the training store,
-- real accounts never see it (the Super Admin sees both). Wiped with scripts/cleanup-training.mjs.
alter table branches add column if not exists is_training boolean not null default false;
alter table profiles add column if not exists is_training boolean not null default false;

create or replace function is_training_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_training from profiles where id = auth.uid()), false)
$$;
revoke execute on function is_training_user() from public, anon;
grant execute on function is_training_user() to authenticated;

create or replace function can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when is_real_admin() then true
    when coalesce((select is_training from branches where id = b), false) <> is_training_user() then false
    when has_role('associate', 'manager') then in_my_branch(b)
    when has_role('courier', 'hq', 'technician', 'supervisor', 'cs', 'finance', 'ops') then true
    else false
  end
$$;

insert into branches (code, name, is_hq, active, is_training)
values ('TRN', 'فرع تدريب', false, true, true)
on conflict (code) do update set is_training = true, active = true;
