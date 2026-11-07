-- Store WhatsApp number (shown on receipts and the customer tracking page)
alter table branches add column if not exists whatsapp text
  check (whatsapp is null or whatsapp ~ '^\+?[0-9]{8,15}$');

-- Repair cost items: product item code -> ERPNext cost item (spare part / service) with its price.
-- Maintained by the Super Admin; technicians pick from them in the diagnosis quote.
create table if not exists item_cost_links (
  id uuid primary key default gen_random_uuid(),
  item_code text not null,
  cost_item_code text not null,
  cost_item_name text not null,
  price numeric(12,2),            -- before VAT
  price_source text not null default 'manual' check (price_source in ('erp', 'manual')),
  price_synced_at timestamptz,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (item_code, cost_item_code)
);
alter table item_cost_links enable row level security;
create policy item_cost_links_read on item_cost_links for select to authenticated
  using (current_role_name() in ('technician', 'supervisor', 'hq') or is_real_admin());
-- writes go through the server with the service key after a Super Admin check

create or replace function track_ticket(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tickets; q quotations; c customers;
begin
  select * into t from tickets where tracking_token = p_token and status <> 'draft';
  if not found then return null; end if;
  select * into c from customers where id = t.customer_id;
  select * into q from quotations where ticket_id = t.id order by sent_at desc nulls last limit 1;
  return jsonb_build_object(
    'ticket_no', t.ticket_no,
    'item_name', t.item_name,
    'status', t.status,
    'branch', (select name from branches where id = t.branch_id),
    'branch_whatsapp', (select whatsapp from branches where id = t.branch_id),
    'first_name', split_part(c.full_name, ' ', 1),
    'created_at', t.created_at,
    'warranty', coalesce(t.warranty_final, t.warranty_provisional),
    'amount_due', amount_due(t.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.at) order by h.at)
                         from status_history h where h.ticket_id = t.id), '[]'),
    'quote', case when q.id is null then null else jsonb_build_object(
      'status', q.status, 'lines', q.lines, 'subtotal', q.subtotal, 'tax', q.tax, 'total', q.total, 'sent_at', q.sent_at) end
  );
end $$;
