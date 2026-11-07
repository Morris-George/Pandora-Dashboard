-- The Super Admin works across every store, training store included, also while "View as" another role
create or replace function can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when is_real_admin() or is_admin_account() then true
    when coalesce((select is_training from branches where id = b), false) <> is_training_user() then false
    when has_role('associate', 'manager', 'courier') then in_my_branch(b)
    when has_role('hq', 'technician', 'supervisor', 'cs', 'finance', 'ops', 'delivery') then true
    else false
  end
$$;
