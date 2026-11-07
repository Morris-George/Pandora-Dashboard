-- Customer email notifications (instead of SMS for now).
-- A status change the customer should know about queues one email; the app sends the queue.
create table email_outbox (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets (id) on delete cascade,
  kind text not null check (kind in ('received', 'quote', 'ready', 'collected')),
  to_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (ticket_id, kind)
);
alter table email_outbox enable row level security;
create policy email_outbox_read on email_outbox for select to authenticated using (has_role('cs', 'ops'));
create index email_outbox_pending on email_outbox (created_at) where status = 'pending';

create or replace function queue_customer_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; em text; ok boolean;
begin
  k := case new.to_status
    when 'received_at_branch' then 'received'
    when 'awaiting_customer_approval' then 'quote'
    when 'ready_for_pickup' then 'ready'
    when 'collected' then 'collected' end;
  if k is null then return new; end if;
  select c.email, c.notify_consent into em, ok from tickets t join customers c on c.id = t.customer_id where t.id = new.ticket_id;
  if em is null or em = '' or not ok then return new; end if;
  insert into email_outbox (ticket_id, kind, to_email) values (new.ticket_id, k, em) on conflict (ticket_id, kind) do nothing;
  return new;
end $$;

create trigger status_history_email after insert on status_history
  for each row execute function queue_customer_email();
