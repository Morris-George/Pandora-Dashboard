-- Super Admin correction: set tickets to any status (no transition rules), with a reason.
-- Recorded in the ticket timeline and the audit log. Custody and shipments are not changed.
create or replace function admin_set_status(p_tickets uuid[], p_to ticket_status, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare t tickets; n int := 0;
begin
  if not is_real_admin() then raise exception 'only a Super Admin can do this' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = 'P0001'; end if;
  for t in select * from tickets where id = any (p_tickets) for update loop
    continue when t.status = p_to;
    insert into status_history (ticket_id, from_status, to_status, reason) values (t.id, t.status, p_to, 'Super Admin: ' || trim(p_reason));
    update tickets set status = p_to, updated_at = now() where id = t.id;
    insert into audit_log (entity, entity_id, action, new_value)
      values ('tickets', t.id::text, 'admin_status_override', jsonb_build_object('from', t.status, 'to', p_to, 'reason', trim(p_reason)));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function admin_set_status(uuid[], ticket_status, text) from public, anon;
grant execute on function admin_set_status(uuid[], ticket_status, text) to authenticated;
