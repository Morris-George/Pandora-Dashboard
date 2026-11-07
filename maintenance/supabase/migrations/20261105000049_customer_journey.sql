-- Customer journey: rating after pickup, expected-ready date and photos on the tracking page,
-- and automatic pickup reminder emails after 3, 7 and 14 days.

-- 1) Rating (1–5) and an optional comment, once per ticket, from the tracking page
create table if not exists ticket_feedback (
  ticket_id uuid primary key references tickets (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  at timestamptz not null default now()
);
alter table ticket_feedback enable row level security;
create policy ticket_feedback_read on ticket_feedback for select to authenticated using (can_see_ticket(ticket_id));

create or replace function track_feedback(p_token text, p_rating int, p_comment text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  select * into t from tickets where tracking_token = p_token;
  if not found or t.status not in ('collected', 'closed') then return false; end if;
  if p_rating not between 1 and 5 then return false; end if;
  insert into ticket_feedback (ticket_id, rating, comment) values (t.id, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
    on conflict (ticket_id) do nothing;
  return found;
end $$;
revoke execute on function track_feedback(text, int, text) from public;
grant execute on function track_feedback(text, int, text) to anon, authenticated;

-- 2) Tracking data: expected-ready date (SLA targets of the remaining stages), photos and rating
create or replace function track_ticket(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tickets; q quotations; c customers; since timestamptz; eta timestamptz;
  flow ticket_status[] := array['received_at_branch','awaiting_dispatch','in_transit_to_hq','received_at_hq','under_diagnosis','in_repair','quality_check','ready_to_return','in_transit_to_branch']::ticket_status[];
  pos int;
begin
  select * into t from tickets where tracking_token = p_token and status <> 'draft';
  if not found then return null; end if;
  select * into c from customers where id = t.customer_id;
  select * into q from quotations where ticket_id = t.id order by sent_at desc nulls last limit 1;
  -- Expected ready: time already in the current stage's target, plus the targets of the stages still ahead
  pos := array_position(flow, t.status);
  if pos is not null then
    select coalesce(max(h.at), t.created_at) into since from status_history h where h.ticket_id = t.id and h.to_status = t.status;
    select since + make_interval(secs => coalesce(sum(r.max_days), 0) * 86400) into eta
      from sla_rules r where r.status = any (flow[pos:]);
    if eta < now() then eta := now() + interval '1 day'; end if;
  end if;
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
    'eta', eta,
    'media', coalesce((select jsonb_agg(jsonb_build_object('stage', m.stage, 'path', m.storage_path) order by m.captured_at)
                       from ticket_media m where m.ticket_id = t.id and m.stage in ('intake', 'after_repair')), '[]'),
    'rated', exists (select 1 from ticket_feedback f where f.ticket_id = t.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.at) order by h.at)
                         from status_history h where h.ticket_id = t.id), '[]'),
    'quote', case when q.id is null then null else jsonb_build_object(
      'status', q.status, 'lines', q.lines, 'subtotal', q.subtotal, 'tax', q.tax, 'total', q.total, 'sent_at', q.sent_at) end
  );
end $$;

-- 3) Pickup reminders: one email each after 3, 7 and 14 days ready for pickup (called by the daily cron)
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('received', 'quote', 'ready', 'collected', 'reminder3', 'reminder7', 'reminder14'));

create or replace function queue_pickup_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; d int; k int;
begin
  foreach d in array array[3, 7, 14] loop
    insert into email_outbox (ticket_id, kind, to_email)
    select t.id, 'reminder' || d, c.email
    from tickets t join customers c on c.id = t.customer_id
    where t.status = 'ready_for_pickup' and coalesce(c.email, '') <> '' and c.notify_consent
      and (select max(h.at) from status_history h where h.ticket_id = t.id and h.to_status = 'ready_for_pickup') <= now() - make_interval(days => d)
    on conflict (ticket_id, kind) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function queue_pickup_reminders() from public, anon, authenticated;
