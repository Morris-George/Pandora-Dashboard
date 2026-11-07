-- Two more optional steps for Admin → Workflow (on by default):
--   cs_quote:          Customer Service records the customer's answer to a quote; off = the store records it
--   supervisor_assign: the supervisor assigns the technician; off = a technician takes the ticket
-- The status rules are not widened: when a step is off these RPCs move the ticket with skip_step(),
-- so store staff or technicians cannot make the same moves through transition_ticket() directly.
update app_settings set value = jsonb_build_object('cs_quote', true, 'supervisor_assign', true) || value where key = 'workflow';

create or replace function respond_quote(p_ticket uuid, p_approve boolean, p_via text, p_call_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q quotations; br uuid; store boolean;
begin
  select branch_id into br from tickets where id = p_ticket;
  store := not has_role('cs') and not workflow_on('cs_quote') and has_role('associate', 'manager') and in_my_branch(br);
  if not (has_role('cs') or store) then raise exception 'only Customer Service can record the answer' using errcode = '42501'; end if;
  if p_via not in ('link', 'phone_agent') then raise exception 'invalid channel' using errcode = 'P0001'; end if;
  if p_via = 'phone_agent' and coalesce(trim(p_call_ref), '') = '' then
    raise exception 'call reference is required for phone answers' using errcode = 'P0001';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = 'P0001'; end if;
  select * into q from quotations where ticket_id = p_ticket and status = 'sent' order by sent_at desc limit 1 for update;
  if not found then raise exception 'no quote waiting for this ticket' using errcode = 'P0001'; end if;

  update quotations set status = case when p_approve then 'approved' else 'rejected' end,
    responded_at = now(), responded_via = p_via, call_reference = nullif(trim(p_call_ref), '')
    where id = q.id;
  if store then
    perform skip_step(p_ticket, case when p_approve then 'in_repair' else 'quote_rejected' end::ticket_status,
      'Recorded by the store (Customer Service step is off)' || coalesce(': ' || nullif(trim(p_reason), ''), ''));
  else
    perform transition_ticket(p_ticket, case when p_approve then 'in_repair' else 'quote_rejected' end::ticket_status, p_reason);
  end if;
end $$;

-- Rejected quote: the item goes back unrepaired (CS or supervisor; the store when the CS step is off)
create or replace function return_unrepaired(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or not can_see_branch(t.branch_id) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  if t.status <> 'quote_rejected' then raise exception 'transition not allowed' using errcode = 'P0001'; end if;
  if has_role('cs', 'supervisor') then
    perform transition_ticket(p_ticket, 'ready_to_return');
  elsif not workflow_on('cs_quote') and has_role('associate', 'manager') and in_my_branch(t.branch_id) then
    perform skip_step(p_ticket, 'ready_to_return', 'Returned unrepaired by the store (Customer Service step is off)');
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke execute on function return_unrepaired(uuid) from public, anon;
grant execute on function return_unrepaired(uuid) to authenticated;

create or replace function start_diagnosis(p_ticket uuid, p_technician uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  if not exists (select 1 from profiles where id = p_technician and role = 'technician' and active) then
    raise exception 'pick an active technician' using errcode = 'P0001';
  end if;
  if has_role('hq', 'supervisor') then
    perform transition_ticket(p_ticket, 'under_diagnosis');
  elsif has_role('technician') and not workflow_on('supervisor_assign') and p_technician = auth.uid() then
    -- Supervisor assignment is off: a technician takes the ticket for themselves
    select * into t from tickets where id = p_ticket for update;
    if not found or not can_see_branch(t.branch_id) or t.status <> 'received_at_hq' then
      raise exception 'ticket is not waiting for a technician' using errcode = 'P0001';
    end if;
    perform skip_step(p_ticket, 'under_diagnosis', 'Taken by the technician (supervisor assignment is off)');
  else
    raise exception 'only a supervisor can assign technicians' using errcode = '42501';
  end if;
  update tickets set assigned_technician = p_technician, updated_at = now() where id = p_ticket;
end $$;
