-- Optional dispatch steps, switched in Admin → Workflow (both on by default):
--   manager_approval: a second branch manager approves the bag before it leaves
--   area_manager:     the area manager collects and scans the bag (custody handover)
-- Off = the step is skipped, e.g. when items go straight to an outside service center.
insert into app_settings (key, value, updated_by)
  values ('workflow', '{"manager_approval": true, "area_manager": true}'::jsonb, null)
  on conflict (key) do nothing;

create or replace function workflow_on(p_step text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> p_step)::boolean from app_settings where key = 'workflow'), true)
$$;

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

  -- Manager approval switched off: the bag leaves straight away
  if not workflow_on('manager_approval') then
    foreach tid in array p_tickets loop
      perform transition_ticket(tid, 'in_transit_to_hq');
      perform move_ticket(tid, 'in_transit', b.id);
    end loop;
    update dispatch_batches set status = 'in_transit' where id = b.id returning * into b;
    insert into audit_log (entity, entity_id, action, new_value)
      values ('dispatch_batches', b.id::text, 'approval_skipped', '{}'::jsonb);
  end if;
  return b;
end $$;

create or replace function receive_batch(p_batch uuid, p_scanned text[])
returns dispatch_batches language plpgsql security definer set search_path = public as $$
declare b dispatch_batches; it record; missing int := 0;
begin
  select * into b from dispatch_batches where id = p_batch for update;
  if not found or not can_see_branch(b.branch_id) then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if b.status <> 'in_transit' then raise exception 'batch is not in transit' using errcode = 'P0001'; end if;
  if b.courier_id is null and workflow_on('area_manager') then raise exception 'the area manager has not collected this batch yet' using errcode = 'P0001'; end if;
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

-- With approval off the packer (associate or manager) sends the bag; approve_batch still requires a manager
update status_transitions set allowed_roles = '{manager,associate}'
  where from_status = 'awaiting_dispatch' and to_status = 'in_transit_to_hq';
