-- Pickup at the branch (BRD 6.7). Identity check, payment and ERP hand-off happen in one step.

create table payments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'card', 'instapay', 'wallet')),
  receipt_ref text,
  received_by uuid not null references profiles (id) default auth.uid(),
  received_at timestamptz not null default now()
);
alter table payments enable row level security;
create policy payments_read on payments for select to authenticated
  using (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id))
         and has_role('associate', 'manager', 'finance', 'ops'));
create trigger audit_payments after insert or update on payments for each row execute function audit_row();

-- Amount the customer owes: the approved quote, less any deposit
create or replace function amount_due(p_ticket uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select total from quotations where ticket_id = p_ticket and status = 'approved'
                               order by responded_at desc limit 1), 0)
                     - (select deposit from tickets where id = p_ticket))
$$;

create or replace function collect_ticket(p_ticket uuid, p_mobile_last4 text, p_method text, p_amount numeric,
                                          p_receipt text, p_collected_by text)
returns text language plpgsql security definer set search_path = public as $$
declare t tickets; mob text; due numeric;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or not (has_role('associate', 'manager') and in_my_branch(t.branch_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if t.status not in ('ready_for_pickup', 'uncollected') then raise exception 'ticket is not ready for pickup' using errcode = 'P0001'; end if;

  select mobile into mob from customers where id = t.customer_id;
  if right(mob, 4) <> trim(coalesce(p_mobile_last4, '')) then
    insert into audit_log (entity, entity_id, action) values ('tickets', p_ticket::text, 'pickup_identity_failed');
    raise exception 'identity check failed' using errcode = '42501';
  end if;

  due := amount_due(p_ticket);
  if due > 0 then
    if p_method not in ('cash', 'card', 'instapay', 'wallet') then raise exception 'choose a payment method' using errcode = 'P0001'; end if;
    if coalesce(p_amount, 0) <> due then raise exception 'amount must equal the amount due' using errcode = 'P0001'; end if;
    if p_method <> 'cash' and coalesce(trim(p_receipt), '') = '' then raise exception 'receipt reference is required' using errcode = 'P0001'; end if;
    insert into payments (ticket_id, amount, method, receipt_ref) values (p_ticket, due, p_method, nullif(trim(p_receipt), ''));
    -- ERP hand-off (BRD 7): invoice + payment, idempotent per ticket
    insert into integration_outbox (ticket_id, action, idempotency_key, payload) values
      (p_ticket, 'sales_invoice', 'si-' || t.ticket_no, jsonb_build_object('ticket_no', t.ticket_no, 'total', due)),
      (p_ticket, 'payment_entry', 'pe-' || t.ticket_no, jsonb_build_object('ticket_no', t.ticket_no, 'amount', due, 'method', p_method, 'receipt', p_receipt))
    on conflict (idempotency_key) do nothing;
  end if;

  perform transition_ticket(p_ticket, 'collected', nullif(trim(p_collected_by), ''));
  -- Nothing to reconcile: close now. Paid tickets stay 'collected' until Finance confirms the ERP posting.
  if due = 0 then
    perform transition_ticket(p_ticket, 'closed');
    return 'closed';
  end if;
  return 'collected';
end $$;

revoke execute on function collect_ticket(uuid, text, text, numeric, text, text), amount_due(uuid) from public, anon;
grant execute on function collect_ticket(uuid, text, text, numeric, text, text), amount_due(uuid) to authenticated;
