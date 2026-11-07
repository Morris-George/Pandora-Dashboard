-- A batch that arrived short (status 'incident') can be resolved item by item:
--   receive_late_item: the receiver scans an item that turned up later; it continues its cycle
--   mark_item_lost:    Ops (or the Super Admin) confirms an item is lost; the ticket becomes lost_in_transit
-- When no item is still pending, the batch becomes 'received'.

create or replace function batch_close_if_resolved(p_batch uuid) returns void
language sql security definer set search_path = public as $$
  update dispatch_batches set status = 'received'
  where id = p_batch and status = 'incident' and not exists (
    select 1 from batch_items bi join tickets t on t.id = bi.ticket_id
    where bi.batch_id = p_batch and not bi.scanned_in and t.status in ('in_transit_to_hq', 'in_transit_to_branch'));
$$;
revoke execute on function batch_close_if_resolved(uuid) from public, anon, authenticated;

create or replace function receive_late_item(p_batch uuid, p_ticket_no text)
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; tid uuid;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'incident' then raise exception 'batch is not an incident' using errcode = 'P0001'; end if;
  if not is_admin_account() then
    if b.direction = 'outbound' and not has_role('hq', 'technician', 'supervisor') then raise exception 'only HQ can receive' using errcode = '42501'; end if;
    if b.direction = 'return' and not (has_role('associate', 'manager') and in_my_branch(b.branch_id)) then
      raise exception 'only the destination branch can receive' using errcode = '42501';
    end if;
  end if;
  select bi.ticket_id into tid from batch_items bi join tickets t on t.id = bi.ticket_id
    where bi.batch_id = p_batch and not bi.scanned_in and upper(t.ticket_no) = upper(trim(p_ticket_no))
      and t.status in ('in_transit_to_hq', 'in_transit_to_branch');
  if tid is null then raise exception 'item is not pending in this batch' using errcode = 'P0001'; end if;

  update batch_items set scanned_in = true where batch_id = p_batch and ticket_id = tid;
  update tickets set held_by = auth.uid(), held_since = now() where id = tid;
  if b.direction = 'outbound' then
    perform transition_ticket(tid, 'received_at_hq');
    perform move_ticket(tid, 'hq', p_batch);
  else
    perform transition_ticket(tid, 'ready_for_pickup');
    perform move_ticket(tid, 'branch', p_batch);
  end if;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('dispatch_batches', p_batch::text, 'late_item_received', jsonb_build_object('ticket_id', tid));
  perform batch_close_if_resolved(p_batch);
  select * into b from dispatch_batches where id = p_batch;
  return b;
end $$;

create or replace function mark_item_lost(p_batch uuid, p_ticket_no text, p_reason text)
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; t tickets;
begin
  if not (has_role('ops') or is_admin_account()) then raise exception 'only Ops can confirm a lost item' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = 'P0001'; end if;
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or b.status <> 'incident' then raise exception 'batch is not an incident' using errcode = 'P0001'; end if;
  select tk.* into t from batch_items bi join tickets tk on tk.id = bi.ticket_id
    where bi.batch_id = p_batch and not bi.scanned_in and upper(tk.ticket_no) = upper(trim(p_ticket_no))
      and tk.status in ('in_transit_to_hq', 'in_transit_to_branch') for update of tk;
  if t.id is null then raise exception 'item is not pending in this batch' using errcode = 'P0001'; end if;

  insert into status_history (ticket_id, from_status, to_status, reason) values (t.id, t.status, 'lost_in_transit', p_reason);
  update tickets set status = 'lost_in_transit', updated_at = now() where id = t.id;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('dispatch_batches', p_batch::text, 'item_lost', jsonb_build_object('ticket_id', t.id, 'reason', p_reason));
  perform batch_close_if_resolved(p_batch);
  select * into b from dispatch_batches where id = p_batch;
  return b;
end $$;

revoke execute on function receive_late_item(uuid, text) from public, anon;
revoke execute on function mark_item_lost(uuid, text, text) from public, anon;
grant execute on function receive_late_item(uuid, text) to authenticated;
grant execute on function mark_item_lost(uuid, text, text) to authenticated;
