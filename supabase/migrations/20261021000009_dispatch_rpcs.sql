-- Dispatch & returns (BRD 6.2 / 6.6). Each step is one atomic RPC so a batch and its tickets
-- can never disagree. Ticket status still goes through transition_ticket(), so role rules apply.

create or replace function move_ticket(p_ticket uuid, p_to_location text, p_batch uuid)
returns void language plpgsql security definer set search_path = public as $$
declare loc text;
begin
  select current_location into loc from tickets where id = p_ticket;
  update tickets set current_location = p_to_location, updated_at = now() where id = p_ticket;
  insert into location_movements (ticket_id, from_location, to_location, batch_id) values (p_ticket, loc, p_to_location, p_batch);
end $$;
revoke execute on function move_ticket(uuid, text, uuid) from public, anon, authenticated;

-- Branch packs a sealed bag for HQ; a second person approves it (SoD-3)
create or replace function create_outbound_batch(p_branch uuid, p_seal text, p_tickets uuid[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; tid uuid;
begin
  if not has_role('associate', 'manager') or not in_my_branch(p_branch) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(trim(p_seal), '') = '' then raise exception 'seal number is required' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_tickets, 1), 0) = 0 then raise exception 'select at least one ticket' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(p_tickets) x left join tickets t on t.id = x
             where t.id is null or t.branch_id <> p_branch or t.status <> 'received_at_branch') then
    raise exception 'every ticket must be received at this branch' using errcode = 'P0001';
  end if;

  insert into dispatch_batches (batch_no, direction, branch_id, seal_no)
    values ('DB-' || nextval('batch_seq'), 'outbound', p_branch, trim(p_seal)) returning * into b;
  foreach tid in array p_tickets loop
    perform transition_ticket(tid, 'awaiting_dispatch');
    insert into batch_items (batch_id, ticket_id) values (b.id, tid);
  end loop;
  return b;
end $$;

-- Branch manager (not the packer) approves; the bag leaves with the courier
create or replace function approve_batch(p_batch uuid)
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; tid uuid;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not has_role('manager') then raise exception 'only a branch manager can approve' using errcode = '42501'; end if;
  if b.direction <> 'outbound' or b.status <> 'awaiting_approval' then raise exception 'batch is not awaiting approval' using errcode = 'P0001'; end if;
  if b.sent_by = auth.uid() then raise exception 'SoD: the person who packed the batch cannot approve it' using errcode = '42501'; end if;

  for tid in select ticket_id from batch_items where batch_id = p_batch loop
    perform transition_ticket(tid, 'in_transit_to_hq');
    perform move_ticket(tid, 'in_transit', p_batch);
  end loop;
  update dispatch_batches set status = 'in_transit', approved_by = auth.uid() where id = p_batch returning * into b;
  return b;
end $$;

-- Supervisor sends finished items back to a branch
create or replace function create_return_batch(p_branch uuid, p_seal text, p_tickets uuid[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; tid uuid;
begin
  if not has_role('supervisor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_seal), '') = '' then raise exception 'seal number is required' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_tickets, 1), 0) = 0 then raise exception 'select at least one ticket' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(p_tickets) x left join tickets t on t.id = x
             where t.id is null or t.branch_id <> p_branch or t.status <> 'ready_to_return') then
    raise exception 'every ticket must be ready to return to this branch' using errcode = 'P0001';
  end if;

  insert into dispatch_batches (batch_no, direction, branch_id, seal_no, status)
    values ('RB-' || nextval('batch_seq'), 'return', p_branch, trim(p_seal), 'in_transit') returning * into b;
  foreach tid in array p_tickets loop
    insert into batch_items (batch_id, ticket_id) values (b.id, tid);
    perform transition_ticket(tid, 'in_transit_to_branch');
    perform move_ticket(tid, 'in_transit', b.id);
  end loop;
  return b;
end $$;

-- Receiver scans each item. Anything not scanned keeps the batch in 'incident' for Ops.
create or replace function receive_batch(p_batch uuid, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; it record; missing int := 0;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.direction = 'outbound' and not has_role('hq') then raise exception 'only HQ intake can receive' using errcode = '42501'; end if;
  if b.direction = 'return' and not (has_role('associate', 'manager') and in_my_branch(b.branch_id)) then
    raise exception 'only the destination branch can receive' using errcode = '42501';
  end if;
  if b.sent_by = auth.uid() then raise exception 'SoD: the sender cannot receive the batch' using errcode = '42501'; end if;

  for it in select bi.ticket_id, t.ticket_no from batch_items bi join tickets t on t.id = bi.ticket_id where bi.batch_id = p_batch loop
    if upper(it.ticket_no) = any (select upper(trim(s)) from unnest(p_scanned) s) then
      update batch_items set scanned_in = true where batch_id = p_batch and ticket_id = it.ticket_id;
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

  update dispatch_batches set received_by = auth.uid(), status = case when missing = 0 then 'received' else 'incident' end::batch_status
    where id = p_batch returning * into b;
  if missing > 0 then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'batch_incident', jsonb_build_object('missing', missing));
  end if;
  return b;
end $$;

revoke execute on function create_outbound_batch(uuid, text, uuid[]), approve_batch(uuid),
  create_return_batch(uuid, text, uuid[]), receive_batch(uuid, text[]) from public, anon;
grant execute on function create_outbound_batch(uuid, text, uuid[]), approve_batch(uuid),
  create_return_batch(uuid, text, uuid[]), receive_batch(uuid, text[]) to authenticated;
