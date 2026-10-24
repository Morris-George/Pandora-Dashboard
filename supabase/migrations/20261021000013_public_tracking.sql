-- Customer tracking page (BRD 8). Public (anon) access goes only through these functions:
-- they return a minimal, customer-safe view and never staff names or full contact details.
-- Quote answers and lookups need the last 4 digits of the mobile; failures are throttled.

create table public_attempts (
  id bigint generated always as identity primary key,
  key text not null,          -- ticket token or ticket number
  ok boolean not null,
  at timestamptz not null default now()
);
create index on public_attempts (key, at);
alter table public_attempts enable row level security; -- no policies: definer functions only

create or replace function public_throttled(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 5 from public_attempts where key = p_key and not ok and at > now() - interval '1 hour'
$$;
revoke execute on function public_throttled(text) from public, anon, authenticated;

-- Customer-facing view of one ticket
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

-- Find a ticket by number + last 4 digits of mobile; returns the token
create or replace function track_lookup(p_ticket_no text, p_last4 text)
returns text language plpgsql security definer set search_path = public as $$
declare tok text; mob text; k text := upper(trim(p_ticket_no));
begin
  if public_throttled(k) then raise exception 'too many attempts, try again later' using errcode = 'P0001'; end if;
  select t.tracking_token, c.mobile into tok, mob from tickets t join customers c on c.id = t.customer_id
    where upper(t.ticket_no) = k and t.status <> 'draft';
  if tok is null or right(mob, 4) <> trim(coalesce(p_last4, '')) then
    insert into public_attempts (key, ok) values (k, false);
    return null;
  end if;
  insert into public_attempts (key, ok) values (k, true);
  return tok;
end $$;

-- Customer approves or rejects the quote from the link
create or replace function track_respond(p_token text, p_last4 text, p_approve boolean, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare t tickets; q quotations; mob text; nxt ticket_status;
begin
  if public_throttled(p_token) then raise exception 'too many attempts, try again later' using errcode = 'P0001'; end if;
  select * into t from tickets where tracking_token = p_token for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select mobile into mob from customers where id = t.customer_id;
  if right(mob, 4) <> trim(coalesce(p_last4, '')) then
    insert into public_attempts (key, ok) values (p_token, false);
    raise exception 'identity check failed' using errcode = '42501';
  end if;
  if t.status <> 'awaiting_customer_approval' then raise exception 'no quote waiting' using errcode = 'P0001'; end if;
  select * into q from quotations where ticket_id = t.id and status = 'sent' order by sent_at desc limit 1 for update;
  if not found then raise exception 'no quote waiting' using errcode = 'P0001'; end if;

  insert into public_attempts (key, ok) values (p_token, true);
  nxt := case when p_approve then 'in_repair' else 'quote_rejected' end;
  update quotations set status = case when p_approve then 'approved' else 'rejected' end,
    responded_at = now(), responded_via = 'link' where id = q.id;
  -- Customer is not a staff user, so record the change directly (same records transition_ticket writes)
  insert into status_history (ticket_id, from_status, to_status, user_id, role, reason)
    values (t.id, t.status, nxt, null, null, coalesce(nullif(trim(p_reason), ''), 'Customer answered via tracking link'));
  update tickets set status = nxt, updated_at = now() where id = t.id;
  insert into audit_log (user_id, role, entity, entity_id, action, new_value)
    values (null, null, 'quotations', q.id::text, 'customer_' || case when p_approve then 'approved' else 'rejected' end, jsonb_build_object('via', 'link'));
  return nxt::text;
end $$;

revoke execute on function track_ticket(text), track_lookup(text, text), track_respond(text, text, boolean, text) from public;
grant execute on function track_ticket(text), track_lookup(text, text), track_respond(text, text, boolean, text) to anon, authenticated;
