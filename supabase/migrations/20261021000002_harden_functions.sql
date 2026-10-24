-- Security advisor fixes: no anonymous access to definer functions; masked customers via a scoped function.

revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Trigger functions are never called directly
revoke execute on function audit_row() from authenticated;
alter function guard_status() set search_path = public;
revoke execute on function guard_status() from authenticated;

-- RLS helpers and the state machine stay callable by signed-in users
grant execute on function current_role_name(), has_role(variadic app_role[]), in_my_branch(uuid),
  can_see_branch(uuid), report_level_for(text), transition_ticket(uuid, ticket_status, text) to authenticated;

-- Replace the definer view: masked customer data only for tickets the caller can already see
drop view if exists customers_masked;
create or replace function customers_masked()
returns table (id uuid, full_name text, mobile_masked text)
language sql stable security definer set search_path = public as $$
  select distinct c.id, c.full_name, left(c.mobile, 3) || '•••••' || right(c.mobile, 3)
  from customers c
  join tickets t on t.customer_id = c.id
  where current_role_name() is not null and current_role_name() <> 'admin' and can_see_branch(t.branch_id)
$$;
revoke execute on function customers_masked() from public, anon;
grant execute on function customers_masked() to authenticated;
