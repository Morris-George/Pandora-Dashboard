-- Pandora Maintenance Platform — core schema (BRD v2.2)
-- Sections: 4 (RBAC, SoD), 5 (state machine), 8 (location ledger), 8A (ERP outbox), 10.2 (report access)

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app_role as enum (
  'associate', 'manager', 'courier', 'hq', 'technician',
  'supervisor', 'cs', 'finance', 'ops', 'admin'
);

create type ticket_status as enum (
  'draft', 'received_at_branch', 'awaiting_dispatch', 'in_transit_to_hq',
  'received_at_hq', 'under_diagnosis', 'awaiting_customer_approval', 'in_repair',
  'awaiting_parts', 'quality_check', 'ready_to_return', 'in_transit_to_branch',
  'ready_for_pickup', 'collected', 'closed',
  'quote_rejected', 'unrepairable', 'lost_in_transit', 'uncollected', 'cancelled'
);

create type warranty_result as enum ('under_warranty', 'out_of_warranty', 'pending_assessment');
create type batch_direction as enum ('outbound', 'return');
create type batch_status as enum ('awaiting_approval', 'in_transit', 'received', 'incident');
create type report_level as enum ('none', 'view', 'export');

-- ---------------------------------------------------------------------------
-- Organisation & users
-- ---------------------------------------------------------------------------
create table branches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  erp_warehouse text,
  is_hq boolean not null default false,
  active boolean not null default true
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Branch scope for branch roles (associate, manager)
create table user_branches (
  user_id uuid references profiles (id) on delete cascade,
  branch_id uuid references branches (id) on delete cascade,
  primary key (user_id, branch_id)
);

-- Role changes require a second admin (SoD-4)
create table role_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  new_role app_role not null,
  requested_by uuid not null references profiles (id),
  approved_by uuid references profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> requested_by)
);

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS
-- ---------------------------------------------------------------------------
create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name() = any (roles), false)
$$;

create or replace function in_my_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b)
$$;

-- Branch roles are limited to their branches; HQ / central roles see all (admin sees no tickets)
create or replace function can_see_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when has_role('associate', 'manager') then in_my_branch(b)
    when has_role('courier', 'hq', 'technician', 'supervisor', 'cs', 'finance', 'ops') then true
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Customers & tickets
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text not null unique check (mobile ~ '^[0-9+]{8,15}$'),
  email text,
  erp_customer text,
  notify_consent boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence ticket_seq start 10000;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique not null default ('MT-' || nextval('ticket_seq')),
  tracking_token text unique not null default encode(extensions.gen_random_bytes(16), 'hex'),
  customer_id uuid not null references customers (id),
  branch_id uuid not null references branches (id),
  item_code text,
  item_name text not null,
  item_tag text,
  erp_sales_invoice text,
  purchase_date date,
  fault_category text not null check (fault_category in
    ('Broken clasp', 'Broken chain', 'Missing stone', 'Tarnish / discoloration', 'Sizing', 'Other')),
  fault_notes text,
  constraint other_fault_needs_comment check (fault_category <> 'Other' or length(trim(coalesce(fault_notes, ''))) > 0),
  accessories text,
  status ticket_status not null default 'draft',
  current_location text not null default 'branch',
  warranty_provisional warranty_result not null default 'pending_assessment',
  warranty_final warranty_result,
  assigned_technician uuid references profiles (id),
  quote_total numeric(12, 2) not null default 0,
  deposit numeric(12, 2) not null default 0,
  erp_repair_invoice text,
  erp_payment text,
  sla_due timestamptz,
  created_by uuid not null references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tickets (status);
create index on tickets (branch_id);

create table ticket_media (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  stage text not null check (stage in ('intake', 'hq_receipt', 'after_repair', 'pickup', 'signature')),
  storage_path text not null,
  file_hash text,
  captured_by uuid not null references profiles (id) default auth.uid(),
  captured_at timestamptz not null default now()
);

create table diagnoses (
  ticket_id uuid primary key references tickets (id) on delete cascade,
  fault_found text,
  root_cause text,
  exclusion_code text,
  technician uuid references profiles (id),
  override_requested boolean not null default false,
  override_reason text,
  override_approved_by uuid references profiles (id),
  check (override_approved_by is null or override_approved_by <> technician) -- SoD-1
);

create table quotations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  lines jsonb not null default '[]',
  subtotal numeric(12, 2) not null,
  tax numeric(12, 2) not null,
  total numeric(12, 2) not null,
  status text not null default 'draft' check (status in ('draft', 'awaiting_supervisor', 'sent', 'approved', 'rejected', 'expired')),
  approved_internal_by uuid references profiles (id),
  sent_at timestamptz,
  responded_at timestamptz,
  responded_via text check (responded_via in ('link', 'phone_agent')),
  call_reference text,
  created_by uuid references profiles (id) default auth.uid()
);

create table parts_consumption (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  part_code text not null,
  qty numeric(10, 2) not null check (qty > 0),
  unit_cost numeric(12, 2),
  erp_stock_entry text,
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Dispatch batches & location ledger (customer items never touch ERP stock)
-- ---------------------------------------------------------------------------
create sequence batch_seq start 100;

create table dispatch_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text unique not null,
  direction batch_direction not null,
  branch_id uuid not null references branches (id), -- origin for outbound, destination for return
  seal_no text not null,
  status batch_status not null default 'awaiting_approval',
  sent_by uuid not null references profiles (id) default auth.uid(),
  approved_by uuid references profiles (id),
  received_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> sent_by), -- SoD-3
  check (received_by is null or received_by <> sent_by)  -- SoD-3
);

create table batch_items (
  batch_id uuid references dispatch_batches (id) on delete cascade,
  ticket_id uuid references tickets (id),
  scanned_in boolean not null default false,
  primary key (batch_id, ticket_id)
);

create table location_movements (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets (id),
  from_location text,
  to_location text not null,
  batch_id uuid references dispatch_batches (id),
  moved_by uuid references profiles (id) default auth.uid(),
  moved_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit, notifications, ERP outbox
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  role app_role default current_role_name(),
  entity text not null,
  entity_id text,
  action text not null,
  old_value jsonb,
  new_value jsonb
);

create table notification_log (
  id bigint generated always as identity primary key,
  ticket_id uuid references tickets (id),
  channel text not null check (channel in ('sms', 'email', 'whatsapp')),
  template text not null,
  recipient_masked text,
  status text not null default 'queued',
  provider_ref text,
  created_at timestamptz not null default now()
);

create table integration_outbox (
  id bigint generated always as identity primary key,
  ticket_id uuid references tickets (id),
  action text not null check (action in ('sales_invoice', 'payment_entry', 'stock_entry_issue', 'customer_upsert')),
  idempotency_key text unique not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  last_error text,
  erp_doc text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Report access (Admin-managed, BRD 4.6 / 10.2)
-- ---------------------------------------------------------------------------
create table reports (
  key text primary key,
  label text not null,
  is_financial boolean not null default false
);

create table report_access (
  report_key text references reports (key) on delete cascade,
  role app_role not null,
  level report_level not null default 'none',
  updated_by uuid references profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (report_key, role)
);

create or replace function report_level_for(r text) returns report_level
language sql stable security definer set search_path = public as $$
  select coalesce((select level from report_access where report_key = r and role = current_role_name()), 'none')
$$;

-- ---------------------------------------------------------------------------
-- Generic audit trigger
-- ---------------------------------------------------------------------------
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (entity, entity_id, action, old_value, new_value)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
                   (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'ticket_id'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_tickets after insert or update or delete on tickets for each row execute function audit_row();
create trigger audit_batches after insert or update on dispatch_batches for each row execute function audit_row();
create trigger audit_quotes after insert or update on quotations for each row execute function audit_row();
create trigger audit_profiles after insert or update on profiles for each row execute function audit_row();
create trigger audit_report_access after insert or update on report_access for each row execute function audit_row();
create trigger audit_role_changes after insert or update on role_change_requests for each row execute function audit_row();
create trigger audit_diagnoses after insert or update on diagnoses for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- State machine: the ONLY way to change ticket.status (BRD Section 5)
-- ---------------------------------------------------------------------------
create table status_transitions (
  from_status ticket_status not null,
  to_status ticket_status not null,
  allowed_roles app_role[] not null,
  requires_reason boolean not null default false,
  primary key (from_status, to_status)
);

insert into status_transitions (from_status, to_status, allowed_roles, requires_reason) values
  ('draft', 'received_at_branch', '{associate,manager}', false),
  ('draft', 'cancelled', '{associate,manager}', true),
  ('received_at_branch', 'awaiting_dispatch', '{associate,manager}', false),
  ('awaiting_dispatch', 'in_transit_to_hq', '{manager}', false),
  ('in_transit_to_hq', 'received_at_hq', '{hq}', false),
  ('in_transit_to_hq', 'lost_in_transit', '{ops}', true),
  ('received_at_hq', 'under_diagnosis', '{hq,supervisor}', false),
  ('under_diagnosis', 'awaiting_customer_approval', '{technician,supervisor}', false),
  ('under_diagnosis', 'in_repair', '{technician,supervisor}', false),
  ('under_diagnosis', 'unrepairable', '{supervisor}', true),
  ('awaiting_customer_approval', 'in_repair', '{cs}', false),
  ('awaiting_customer_approval', 'quote_rejected', '{cs}', true),
  ('in_repair', 'awaiting_parts', '{technician,supervisor}', true),
  ('awaiting_parts', 'in_repair', '{supervisor}', false),
  ('in_repair', 'quality_check', '{technician}', false),
  ('quality_check', 'ready_to_return', '{supervisor}', false),
  ('quality_check', 'in_repair', '{supervisor}', true),
  ('quote_rejected', 'ready_to_return', '{cs,supervisor}', false),
  ('unrepairable', 'ready_to_return', '{supervisor}', false),
  ('ready_to_return', 'in_transit_to_branch', '{supervisor}', false),
  ('in_transit_to_branch', 'ready_for_pickup', '{associate,manager}', false),
  ('in_transit_to_branch', 'lost_in_transit', '{ops}', true),
  ('ready_for_pickup', 'collected', '{associate,manager}', false),
  ('ready_for_pickup', 'uncollected', '{manager}', true),
  ('uncollected', 'collected', '{associate,manager}', false),
  ('collected', 'closed', '{associate,manager,finance}', false),
  ('lost_in_transit', 'closed', '{ops}', true),
  ('received_at_branch', 'cancelled', '{manager}', true),
  ('awaiting_dispatch', 'cancelled', '{manager}', true),
  ('under_diagnosis', 'cancelled', '{supervisor}', true);

create table status_history (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets (id),
  from_status ticket_status,
  to_status ticket_status not null,
  user_id uuid default auth.uid(),
  role app_role default current_role_name(),
  reason text,
  at timestamptz not null default now()
);

create or replace function transition_ticket(p_ticket uuid, p_to ticket_status, p_reason text default null)
returns tickets
language plpgsql security definer set search_path = public as $$
declare
  t tickets;
  rule status_transitions;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or not can_see_branch(t.branch_id) then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;

  select * into rule from status_transitions where from_status = t.status and to_status = p_to;
  if not found then
    raise exception 'transition % -> % is not allowed', t.status, p_to using errcode = 'P0001';
  end if;
  if not (current_role_name() = any (rule.allowed_roles)) then
    insert into audit_log (entity, entity_id, action, new_value)
    values ('tickets', p_ticket::text, 'denied_transition', jsonb_build_object('from', t.status, 'to', p_to));
    raise exception 'role % may not perform % -> %', current_role_name(), t.status, p_to using errcode = '42501';
  end if;
  if rule.requires_reason and coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for % -> %', t.status, p_to using errcode = 'P0001';
  end if;

  insert into status_history (ticket_id, from_status, to_status, reason) values (p_ticket, t.status, p_to, p_reason);
  update tickets set status = p_to, updated_at = now() where id = p_ticket returning * into t;
  return t;
end $$;

-- Block direct status writes; only transition_ticket (security definer, runs as owner) may change it
create or replace function guard_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'use transition_ticket() to change status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_ticket_status before update on tickets for each row execute function guard_status();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table branches enable row level security;
alter table profiles enable row level security;
alter table user_branches enable row level security;
alter table role_change_requests enable row level security;
alter table customers enable row level security;
alter table tickets enable row level security;
alter table ticket_media enable row level security;
alter table diagnoses enable row level security;
alter table quotations enable row level security;
alter table parts_consumption enable row level security;
alter table dispatch_batches enable row level security;
alter table batch_items enable row level security;
alter table location_movements enable row level security;
alter table audit_log enable row level security;
alter table notification_log enable row level security;
alter table integration_outbox enable row level security;
alter table reports enable row level security;
alter table report_access enable row level security;
alter table status_transitions enable row level security;
alter table status_history enable row level security;

-- Reference data: any active user may read
create policy branches_read on branches for select to authenticated using (current_role_name() is not null);
create policy transitions_read on status_transitions for select to authenticated using (current_role_name() is not null);
create policy reports_read on reports for select to authenticated using (current_role_name() is not null);

-- Profiles: self, or admin; admin manages users (no ticket data)
create policy profiles_self on profiles for select to authenticated using (id = auth.uid() or has_role('admin', 'supervisor', 'manager'));
create policy profiles_admin_write on profiles for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy user_branches_read on user_branches for select to authenticated using (user_id = auth.uid() or has_role('admin'));
create policy user_branches_admin on user_branches for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy role_req_admin on role_change_requests for all to authenticated using (has_role('admin')) with check (has_role('admin'));

-- Customers: roles that may see PII; masked roles get a view instead
create policy customers_read on customers for select to authenticated
  using (has_role('associate', 'manager', 'supervisor', 'cs', 'finance'));
create policy customers_write on customers for insert to authenticated with check (has_role('associate', 'manager'));
create policy customers_update on customers for update to authenticated using (has_role('associate', 'manager', 'cs'));

-- Tickets: branch-scoped read; create at branch only
create policy tickets_read on tickets for select to authenticated using (can_see_branch(branch_id));
create policy tickets_insert on tickets for insert to authenticated
  with check (has_role('associate', 'manager') and in_my_branch(branch_id) and status = 'draft');
create policy tickets_update on tickets for update to authenticated
  using (can_see_branch(branch_id) and has_role('associate', 'manager', 'technician', 'supervisor', 'cs', 'finance'));

create policy media_read on ticket_media for select to authenticated
  using (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id)));
create policy media_insert on ticket_media for insert to authenticated
  with check (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id))
              and has_role('associate', 'manager', 'hq', 'technician', 'supervisor'));

create policy diag_read on diagnoses for select to authenticated using (has_role('technician', 'supervisor', 'cs', 'ops'));
create policy diag_write on diagnoses for all to authenticated using (has_role('technician', 'supervisor')) with check (has_role('technician', 'supervisor'));

create policy quotes_read on quotations for select to authenticated
  using (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id)));
create policy quotes_write on quotations for all to authenticated
  using (has_role('technician', 'supervisor', 'cs')) with check (has_role('technician', 'supervisor', 'cs'));

create policy parts_read on parts_consumption for select to authenticated using (has_role('technician', 'supervisor', 'finance', 'ops'));
create policy parts_write on parts_consumption for insert to authenticated with check (has_role('technician', 'supervisor'));

create policy batches_read on dispatch_batches for select to authenticated using (can_see_branch(branch_id));
create policy batches_insert on dispatch_batches for insert to authenticated
  with check ((direction = 'outbound' and has_role('associate', 'manager') and in_my_branch(branch_id))
           or (direction = 'return' and has_role('supervisor')));
create policy batches_update on dispatch_batches for update to authenticated
  using (can_see_branch(branch_id) and has_role('manager', 'hq', 'associate', 'courier', 'supervisor'));
create policy batch_items_read on batch_items for select to authenticated
  using (exists (select 1 from dispatch_batches b where b.id = batch_id and can_see_branch(b.branch_id)));
create policy batch_items_write on batch_items for all to authenticated
  using (has_role('associate', 'manager', 'hq', 'supervisor')) with check (has_role('associate', 'manager', 'hq', 'supervisor'));

create policy moves_read on location_movements for select to authenticated
  using (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id)));
create policy history_read on status_history for select to authenticated
  using (exists (select 1 from tickets t where t.id = ticket_id and can_see_branch(t.branch_id)));

-- Audit: readable only through the audit report grant; nobody may modify
create policy audit_read on audit_log for select to authenticated using (report_level_for('audit') <> 'none');

create policy notif_read on notification_log for select to authenticated using (has_role('cs', 'supervisor', 'ops'));
create policy outbox_read on integration_outbox for select to authenticated using (has_role('finance', 'admin', 'ops'));

-- Report access: admin edits; each user may read their own role's grants
create policy access_read on report_access for select to authenticated using (has_role('admin') or role = current_role_name());
create policy access_admin on report_access for all to authenticated using (has_role('admin')) with check (has_role('admin'));

-- Masked customer view for courier / hq / technician / ops (BRD 4.1 field-level security)
create or replace view customers_masked with (security_invoker = false) as
  select c.id, c.full_name,
         left(c.mobile, 3) || '•••••' || right(c.mobile, 3) as mobile_masked
  from customers c
  where current_role_name() is not null and current_role_name() <> 'admin';
grant select on customers_masked to authenticated;
