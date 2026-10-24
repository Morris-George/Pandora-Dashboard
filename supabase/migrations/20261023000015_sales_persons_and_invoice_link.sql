-- 1) Sales persons from ERPNext (BRD 8A). The ERPNext group (parent) gives the store; the admin
--    can override it here. Each sync stamps new rows so the Admin screen can highlight them.
create table sales_persons (
  erp_name text primary key,
  erp_group text,                                   -- parent_sales_person in ERPNext
  branch_id uuid references branches (id),          -- store from the ERPNext group
  branch_override uuid references branches (id),    -- admin's choice, wins over the group
  profile_id uuid references profiles (id) on delete set null, -- platform account of this person
  enabled boolean not null default true,
  ignored boolean not null default false,           -- removed by the admin; stays out of lists
  created_run bigint references erp_sync_runs (id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table sales_persons enable row level security;
create policy sales_persons_admin on sales_persons for all to authenticated using (has_role('admin')) with check (has_role('admin'));

-- New ERPNext accounts are stamped with the run that created them (highlighted until the next one)
alter table profiles add column erp_created_run bigint references erp_sync_runs (id);

-- 2) Invoices are issued in ERPNext; the platform only links the ticket to that invoice.
alter table tickets add column erp_repair_invoice_at timestamptz;

drop function if exists collect_ticket(uuid, text, text, numeric, text, text);
create or replace function collect_ticket(p_ticket uuid, p_mobile_last4 text, p_erp_invoice text, p_collected_by text)
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
  -- Money due: the ERPNext invoice number is required (checked against ERPNext by the app first)
  if due > 0 and coalesce(trim(p_erp_invoice), '') = '' then
    raise exception 'erp invoice is required' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_erp_invoice), '') <> '' then
    update tickets set erp_repair_invoice = trim(p_erp_invoice), erp_repair_invoice_at = now() where id = p_ticket;
  end if;

  perform transition_ticket(p_ticket, 'collected', nullif(trim(p_collected_by), ''));
  perform transition_ticket(p_ticket, 'closed');
  return 'closed';
end $$;
revoke execute on function collect_ticket(uuid, text, text, text) from public, anon;
grant execute on function collect_ticket(uuid, text, text, text) to authenticated;
