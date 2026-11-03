-- Super Admin override: approve an outbound batch even when they packed it themselves (no second manager available).
-- A reason is required; it goes into each ticket's timeline and the audit log.
create or replace function admin_approve_batch(p_batch uuid, p_reason text)
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; tid uuid;
begin
  if not is_real_admin() then raise exception 'only a Super Admin can do this' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = 'P0001'; end if;
  select * into b from dispatch_batches where id = p_batch for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.direction <> 'outbound' or b.status <> 'awaiting_approval' then raise exception 'batch is not awaiting approval' using errcode = 'P0001'; end if;

  for tid in select ticket_id from batch_items where batch_id = p_batch loop
    perform transition_ticket(tid, 'in_transit_to_hq', 'Super Admin approval: ' || trim(p_reason));
    perform move_ticket(tid, 'in_transit', p_batch);
  end loop;
  update dispatch_batches set status = 'in_transit', approved_by = auth.uid() where id = p_batch returning * into b;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('dispatch_batches', p_batch::text, 'admin_approve_batch', jsonb_build_object('reason', trim(p_reason)));
  return b;
end $$;
revoke execute on function admin_approve_batch(uuid, text) from public, anon;
grant execute on function admin_approve_batch(uuid, text) to authenticated;
