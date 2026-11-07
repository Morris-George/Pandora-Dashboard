-- Custody chain: the area manager scans every item when collecting a sealed batch, and the receiver
-- (HQ receiving / technician / supervisor at HQ, the store on returns) scans every item on receipt.
-- tickets.held_by shows who holds the item now.
alter table tickets add column if not exists held_by uuid references profiles (id) on delete set null;
alter table tickets add column if not exists held_since timestamptz;
alter table batch_items add column if not exists scanned_out boolean not null default false;

drop function if exists courier_pickup(uuid, text);
create or replace function courier_pickup(p_batch uuid, p_seal text, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; missing int;
begin
  if not has_role('courier') then raise exception 'only an area manager can collect batches' using errcode = '42501'; end if;
  select * into b from dispatch_batches where id = p_batch for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is not null then raise exception 'batch already collected' using errcode = 'P0001'; end if;
  if upper(trim(coalesce(p_seal, ''))) <> upper(b.seal_no) then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'seal_mismatch', jsonb_build_object('entered', p_seal));
    raise exception 'seal number does not match' using errcode = 'P0001';
  end if;
  -- every item must be scanned: the area manager takes custody of exactly what is in the batch
  select count(*) into missing from batch_items bi join tickets t on t.id = bi.ticket_id
    where bi.batch_id = p_batch and not (upper(t.ticket_no) = any (select upper(trim(s)) from unnest(p_scanned) s));
  if missing > 0 then raise exception 'scan every item before collecting (% missing)', missing using errcode = 'P0001'; end if;

  update batch_items set scanned_out = true where batch_id = p_batch;
  update tickets set held_by = auth.uid(), held_since = now() where id in (select ticket_id from batch_items where batch_id = p_batch);
  update dispatch_batches set courier_id = auth.uid(), picked_up_at = now() where id = p_batch returning * into b;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('dispatch_batches', p_batch::text, 'custody_to_area_manager', jsonb_build_object('items', (select count(*) from batch_items where batch_id = p_batch)));
  return b;
end $$;
revoke execute on function courier_pickup(uuid, text, text[]) from public, anon;
grant execute on function courier_pickup(uuid, text, text[]) to authenticated;

create or replace function receive_batch(p_batch uuid, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; it record; missing int := 0;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is null then raise exception 'the area manager has not collected this batch yet' using errcode = 'P0001'; end if;
  if b.direction = 'outbound' and not has_role('hq', 'technician', 'supervisor') then raise exception 'only HQ can receive' using errcode = '42501'; end if;
  if b.direction = 'return' and not (has_role('associate', 'manager') and in_my_branch(b.branch_id)) then
    raise exception 'only the destination branch can receive' using errcode = '42501';
  end if;
  if b.sent_by = auth.uid() or b.courier_id = auth.uid() then raise exception 'SoD: the sender cannot receive the batch' using errcode = '42501'; end if;

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

  update dispatch_batches set received_by = auth.uid(), status = case when missing = 0 then 'received' else 'incident' end::batch_status
    where id = p_batch returning * into b;
  if missing > 0 then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', p_batch::text, 'batch_incident', jsonb_build_object('missing', missing));
  end if;
  return b;
end $$;

-- Technicians and supervisors at HQ may receive incoming batches too
update status_transitions set allowed_roles = '{hq,technician,supervisor}'
  where from_status = 'in_transit_to_hq' and to_status = 'received_at_hq';
