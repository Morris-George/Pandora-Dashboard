-- Super Admin (any "View as" role) may receive a batch they packed or collected themselves, e.g. when testing alone.
-- received_by stays empty in that case (SoD check constraint); the audit log records the override.
create or replace function is_admin_account() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') and admin_session_ok()
$$;
revoke execute on function is_admin_account() from public, anon;
grant execute on function is_admin_account() to authenticated;

create or replace function receive_batch(p_batch uuid, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; it record; missing int := 0; own boolean;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is null and workflow_on('area_manager') then raise exception 'the area manager has not collected this batch yet' using errcode = 'P0001'; end if;
  if b.direction = 'outbound' and not has_role('hq', 'technician', 'supervisor') then raise exception 'only HQ can receive' using errcode = '42501'; end if;
  if b.direction = 'return' and not (has_role('associate', 'manager') and in_my_branch(b.branch_id)) then
    raise exception 'only the destination branch can receive' using errcode = '42501';
  end if;
  own := b.sent_by = auth.uid() or b.courier_id = auth.uid();
  if own and not is_admin_account() then raise exception 'SoD: the sender cannot receive the batch' using errcode = '42501'; end if;

  for it in select bi.ticket_id, t.ticket_no from batch_items bi join tickets t on t.id = bi.ticket_id where bi.batch_id = p_batch loop
    if upper(it.ticket_no) = any (select upper(trim(s)) from unnest(p_scanned) s) then
      update batch_items set scanned_in = true where batch_id = p_batch and ticket_id = it.ticket_id;
      update tickets set held_by = auth.uid(), held_since = now() where id = it.ticket_id;
      if b.direction = 'outbound' then
        perform transition_ticket(it.ticket_id, 'received_at_hq');
        perform move_ticket(it.ticket_id, 'hq', p_batch);
      else
        perform transition_ticket(it.ticket_id, 'ready_for_pickup');
        perform move_ticket(it.ticket_id, 'branch', p_batch);
      end if;
    else
      missing := missing + 1;
    end if;
  end loop;

  update dispatch_batches set received_by = case when b.sent_by = auth.uid() then null else auth.uid() end,
    status = case when missing = 0 then 'received' else 'incident' end::batch_status
    where id = p_batch returning * into b;
  if own then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'admin_receive_own_batch', jsonb_build_object('missing', missing));
  end if;
  if missing > 0 then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'batch_incident', jsonb_build_object('missing', missing));
  end if;
  return b;
end $$;
