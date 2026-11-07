-- More optional steps for Admin → Workflow (both on by default):
--   supervisor_qc:     the supervisor checks the repair; off = a finished repair goes straight to "ready to return"
--   override_approval: the supervisor approves a technician's warranty override; off = the technician's decision applies at once
update app_settings set value = jsonb_build_object('supervisor_qc', true, 'override_approval', true) || value where key = 'workflow';

-- Internal: move a ticket past a step that is switched off (no role rule; recorded in the timeline)
create or replace function skip_step(p_ticket uuid, p_to ticket_status, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare cur ticket_status;
begin
  select status into cur from tickets where id = p_ticket for update;
  insert into status_history (ticket_id, from_status, to_status, reason) values (p_ticket, cur, p_to, p_note);
  update tickets set status = p_to, updated_at = now() where id = p_ticket;
end $$;
revoke execute on function skip_step(uuid, ticket_status, text) from public, anon, authenticated;

create or replace function complete_repair(p_ticket uuid, p_parts jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t tickets; p jsonb;
begin
  select * into t from tickets where id = p_ticket;
  if not found or t.assigned_technician is distinct from auth.uid() then
    raise exception 'only the assigned technician can complete the repair' using errcode = '42501';
  end if;
  for p in select * from jsonb_array_elements(coalesce(p_parts, '[]')) loop
    insert into parts_consumption (ticket_id, part_code, qty) values (p_ticket, trim(p->>'code'), (p->>'qty')::numeric);
  end loop;
  perform transition_ticket(p_ticket, 'quality_check');
  -- Quality check switched off: ready to return straight away
  if not workflow_on('supervisor_qc') then
    perform skip_step(p_ticket, 'ready_to_return', 'Quality check step is off');
  end if;
end $$;

create or replace function submit_diagnosis(
  p_ticket uuid, p_fault text, p_root_cause text, p_warranty warranty_result,
  p_exclusion text, p_override_reason text, p_quote jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare t tickets; needs_override boolean;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or t.status <> 'under_diagnosis' then raise exception 'ticket is not under diagnosis' using errcode = 'P0001'; end if;
  if not (has_role('supervisor') or (has_role('technician') and t.assigned_technician = auth.uid())) then
    raise exception 'only the assigned technician can diagnose' using errcode = '42501';
  end if;
  if coalesce(trim(p_fault), '') = '' then raise exception 'fault found is required' using errcode = 'P0001'; end if;
  if p_warranty not in ('under_warranty', 'out_of_warranty') then raise exception 'choose a warranty result' using errcode = 'P0001'; end if;
  if p_warranty = 'out_of_warranty' and coalesce(jsonb_array_length(p_quote), 0) = 0 then
    raise exception 'out of warranty needs at least one quote line' using errcode = 'P0001';
  end if;

  needs_override := t.warranty_provisional <> 'pending_assessment' and p_warranty <> t.warranty_provisional;
  if needs_override and coalesce(trim(p_override_reason), '') = '' then
    raise exception 'a reason is required to override the warranty' using errcode = 'P0001';
  end if;

  insert into diagnoses (ticket_id, fault_found, root_cause, exclusion_code, technician, warranty_decision,
                         pending_quote, override_requested, override_reason, override_approved_by, submitted_at, decided_at)
  values (p_ticket, trim(p_fault), nullif(trim(p_root_cause), ''), nullif(trim(p_exclusion), ''), auth.uid(), p_warranty,
          case when p_warranty = 'out_of_warranty' then p_quote end, needs_override, nullif(trim(p_override_reason), ''), null, now(), null)
  on conflict (ticket_id) do update set
    fault_found = excluded.fault_found, root_cause = excluded.root_cause, exclusion_code = excluded.exclusion_code,
    technician = excluded.technician, warranty_decision = excluded.warranty_decision, pending_quote = excluded.pending_quote,
    override_requested = excluded.override_requested, override_reason = excluded.override_reason,
    override_approved_by = null, submitted_at = excluded.submitted_at, decided_at = null;

  -- Override approval switched off: the technician's decision applies, the reason stays on record
  if needs_override and workflow_on('override_approval') then return 'override_pending'; end if;
  if needs_override then
    insert into audit_log (entity, entity_id, action, new_value)
      values ('diagnoses', p_ticket::text, 'override_auto_applied', jsonb_build_object('from', t.warranty_provisional, 'to', p_warranty));
  end if;
  perform apply_diagnosis(p_ticket, p_warranty, p_quote);
  return 'applied';
end $$;
