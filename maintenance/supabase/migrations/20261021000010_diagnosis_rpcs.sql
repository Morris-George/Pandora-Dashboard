-- Diagnosis & repair (BRD 6.3 / 6.4). Writes go through RPCs so the warranty override (SoD-1),
-- the quotation and the status change happen together.

alter table diagnoses
  add column warranty_decision warranty_result,
  add column pending_quote jsonb,
  add column submitted_at timestamptz,
  add column decided_at timestamptz;

-- Only the RPCs below write diagnoses (stops a technician approving their own override)
drop policy if exists diag_write on diagnoses;

create or replace function apply_diagnosis(p_ticket uuid, p_warranty warranty_result, p_quote jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare sub numeric(12, 2); vat numeric(12, 2);
begin
  update tickets set warranty_final = p_warranty, updated_at = now() where id = p_ticket;
  if p_warranty = 'under_warranty' then
    perform transition_ticket(p_ticket, 'in_repair');
  else
    select coalesce(sum((l->>'qty')::numeric * (l->>'price')::numeric), 0) into sub from jsonb_array_elements(p_quote) l;
    vat := round(sub * 0.14, 2); -- Egypt VAT
    insert into quotations (ticket_id, lines, subtotal, tax, total, status, sent_at)
      values (p_ticket, p_quote, sub, vat, sub + vat, 'sent', now());
    update tickets set quote_total = sub + vat where id = p_ticket;
    perform transition_ticket(p_ticket, 'awaiting_customer_approval');
  end if;
  update diagnoses set decided_at = now() where ticket_id = p_ticket;
end $$;
revoke execute on function apply_diagnosis(uuid, warranty_result, jsonb) from public, anon, authenticated;

-- Supervisor / HQ assigns a technician and opens diagnosis
create or replace function start_diagnosis(p_ticket uuid, p_technician uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_technician and role = 'technician' and active) then
    raise exception 'pick an active technician' using errcode = 'P0001';
  end if;
  perform transition_ticket(p_ticket, 'under_diagnosis');
  update tickets set assigned_technician = p_technician, updated_at = now() where id = p_ticket;
end $$;

-- Technician records findings. A warranty decision that differs from the branch's provisional
-- result needs a supervisor (SoD-1) before anything moves on.
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

  if needs_override then return 'override_pending'; end if;
  perform apply_diagnosis(p_ticket, p_warranty, p_quote);
  return 'applied';
end $$;

-- Supervisor approves or rejects a warranty override (never their own diagnosis)
create or replace function decide_override(p_ticket uuid, p_approve boolean, p_quote jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare d diagnoses; t tickets;
begin
  if not has_role('supervisor') then raise exception 'only a supervisor can decide' using errcode = '42501'; end if;
  select * into d from diagnoses where ticket_id = p_ticket for update;
  if not found then raise exception 'no override waiting for this ticket' using errcode = 'P0001'; end if;
  select * into t from tickets where id = p_ticket;
  if not d.override_requested or d.decided_at is not null or t.status <> 'under_diagnosis' then
    raise exception 'no override waiting for this ticket' using errcode = 'P0001';
  end if;
  if d.technician = auth.uid() then raise exception 'SoD: you cannot approve your own override' using errcode = '42501'; end if;

  update diagnoses set override_approved_by = case when p_approve then auth.uid() end where ticket_id = p_ticket;
  insert into audit_log (entity, entity_id, action, new_value)
    values ('diagnoses', p_ticket::text, case when p_approve then 'override_approved' else 'override_rejected' end,
            jsonb_build_object('from', t.warranty_provisional, 'to', d.warranty_decision));
  if p_approve then
    perform apply_diagnosis(p_ticket, d.warranty_decision, d.pending_quote);
  elsif t.warranty_provisional = 'out_of_warranty' then
    -- Rejected: stays out of warranty, so a quote is needed
    if coalesce(jsonb_array_length(coalesce(p_quote, d.pending_quote)), 0) = 0 then
      raise exception 'add quote lines to keep it out of warranty' using errcode = 'P0001';
    end if;
    perform apply_diagnosis(p_ticket, 'out_of_warranty', coalesce(p_quote, d.pending_quote));
  else
    perform apply_diagnosis(p_ticket, t.warranty_provisional, null);
  end if;
end $$;

-- Technician finishes the repair and records parts used; goes to supervisor QC
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
end $$;

revoke execute on function start_diagnosis(uuid, uuid), submit_diagnosis(uuid, text, text, warranty_result, text, text, jsonb),
  decide_override(uuid, boolean, jsonb), complete_repair(uuid, jsonb) from public, anon;
grant execute on function start_diagnosis(uuid, uuid), submit_diagnosis(uuid, text, text, warranty_result, text, text, jsonb),
  decide_override(uuid, boolean, jsonb), complete_repair(uuid, jsonb) to authenticated;
